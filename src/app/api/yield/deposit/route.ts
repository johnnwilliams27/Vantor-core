import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getYieldAdapter } from '@/lib/yield/factory';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import {
  PolicyGateService,
  mapYieldDepositToMovement,
  GateError,
  mapGateErrorToHttp,
  type GateActor,
} from '@/lib/policy/gate';
import { buildProductionEvaluate } from '@/lib/policy/gate/production-wiring';
import { ApprovalWorkflowService } from '@/lib/policy/approvals';
import { markPolicyEvaluationExecuted } from '@/lib/policy/persistence/persist-evaluation';

const depositSchema = z.object({
  protocol: z.enum(['aave_v3', 'morpho_reservoir', 'morpho_steakhouse', 'kamino', 'kamino_multiply', 'ondo_usdy', 'sky', 'ethena']),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  chain: z.enum(['ethereum', 'solana']),
  vaultAddress: z.string().max(100).optional(),
  slippage: z.object({
    estimated_slippage_bps: z.number(),
    pool_liquidity_usd: z.number(),
    severity: z.enum(['green', 'yellow', 'red']),
    user_acknowledged: z.boolean(),
  }).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('deposit into yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-deposit', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = depositSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { protocol, token, amount, walletAddress, chain, vaultAddress, slippage } = parsed.data;

  const COMING_SOON_PROTOCOLS = ['sky', 'ethena', 'ondo_usdy'];
  if (COMING_SOON_PROTOCOLS.includes(protocol)) {
    return NextResponse.json(
      { error: 'This protocol is coming soon and not yet available for deposits' },
      { status: 503 },
    );
  }

  const supabase = createAdminClient();

  // Geo-gate: Ondo USDY is only available to non-US enterprises
  if (protocol === 'ondo_usdy') {
    const { data: ent } = await supabase
      .from('enterprises')
      .select('country')
      .eq('id', enterpriseId)
      .single();
    if (!ent?.country || ent.country === 'US') {
      return NextResponse.json(
        { error: 'Ondo USDY is not available in your jurisdiction' },
        { status: 403 },
      );
    }
  }

  // Look up wallet (optional — deposit works even if we don't know the wallet row;
  // the chain address is what matters for the adapter).
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('address', walletAddress)
    .eq('user_id', session.user.id)
    .maybeSingle();

  // ─── Policy gate ───────────────────────────────────────────────────
  // Create the movement first so we have a stable id shared between the
  // yield_transactions row and any approval_request. Row is inserted as
  // 'awaiting_approval' so no execution side effect can occur before the
  // gate clears it.
  const movement = mapYieldDepositToMovement(
    { protocol, token, amount, walletAddress, chain, vaultAddress },
    { userId: session.user.id, enterpriseId: enterpriseId as string, fromAddress: walletAddress },
  );

  const { data: tx, error: txErr } = await supabase
    .from('yield_transactions')
    .insert({
      id: movement.id,
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      protocol,
      chain,
      tx_type: 'deposit',
      underlying_token: token,
      amount: parseFloat(amount),
      amount_usd: parseFloat(amount), // stablecoin ~= 1 USD
      status: 'awaiting_approval',
    })
    .select()
    .single();

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  const gateService = new PolicyGateService(supabase, {
    evaluate: buildProductionEvaluate(supabase),
    approvalService: new ApprovalWorkflowService(supabase),
  });
  const actor: GateActor = {
    user_id: session.user.id,
    role: session.user.role as GateActor['role'],
    enterprise_id: enterpriseId as string,
  };

  let gateResult;
  try {
    gateResult = await gateService.gate(movement, actor);
  } catch (err) {
    if (err instanceof GateError) {
      await supabase
        .from('yield_transactions')
        .update({ status: 'denied', denial_reason: err.reason_code })
        .eq('id', tx.id)
        .eq('enterprise_id', enterpriseId as string);
      await writeAuditLog({
        userId: session.user.id,
        action: 'yield_deposit_blocked' as any,
        entityType: 'yield_transaction',
        entityId: tx.id,
        details: { reason_code: err.reason_code, ...(err.details as Record<string, unknown>) },
      });
      const { status, body } = mapGateErrorToHttp(err);
      return NextResponse.json(body, { status });
    }
    throw err;
  }

  // require_approval: transaction stays 'awaiting_approval'. Adapter is NOT
  // invoked — no external state created. Approver's later click will produce
  // the approval outcome; execution-on-approve is a follow-up PR (needs an
  // executor registry keyed on movement.kind — see project memory).
  if (gateResult.verdict === 'require_approval') {
    await writeAuditLog({
      userId: session.user.id,
      action: 'yield_deposit_requires_approval' as any,
      entityType: 'yield_transaction',
      entityId: tx.id,
      details: {
        approval_request_id: gateResult.approval_request.id,
        chain_id: gateResult.approval_request.chain_id,
        protocol,
        token,
        amount,
      },
    });
    return NextResponse.json(
      { data: tx, approval_request: gateResult.approval_request },
      { status: 202 },
    );
  }

  // allow_auto: flip to 'pending' and run the adapter. Same failure
  // modes as before (adapter error → status='failed') plus a new
  // pending→completed transition from the adapter result.
  const { error: flipErr } = await supabase
    .from('yield_transactions')
    .update({ status: 'pending' })
    .eq('id', tx.id)
    .eq('enterprise_id', enterpriseId as string);
  if (flipErr) {
    await supabase
      .from('yield_transactions')
      .update({ status: 'denied', denial_reason: 'gate_update_failed' })
      .eq('id', tx.id)
      .eq('enterprise_id', enterpriseId as string);
    return NextResponse.json(
      {
        reason_code: 'gate_update_failed',
        human_readable: 'Policy gate cleared the deposit but the status flip failed.',
        user_action: 'Retry the deposit.',
        details: { transaction_id: tx.id },
      },
      { status: 500 },
    );
  }

  try {
    const adapter = getYieldAdapter(protocol as YieldProtocolId);
    const result = await adapter.deposit({ token, amount, walletAddress, chain, vaultAddress });

    // Upsert position
    const { data: existingPos } = await supabase
      .from('yield_positions')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .eq('protocol', protocol)
      .eq('underlying_token', token)
      .eq('is_active', true)
      .maybeSingle();

    let positionId: string;

    if (existingPos) {
      const newDeposited = parseFloat(existingPos.deposited_amount) + parseFloat(amount);
      const newCurrentValue = parseFloat(existingPos.current_value_usd) + parseFloat(amount);
      const newYieldTokenBalance = parseFloat(existingPos.yield_token_balance || '0') + result.tokensReceived;
      const newAccruedYield = Math.max(0, newCurrentValue - newDeposited);
      await supabase
        .from('yield_positions')
        .update({
          deposited_amount: newDeposited,
          yield_token_balance: newYieldTokenBalance,
          current_value_usd: newCurrentValue,
          accrued_yield_usd: newAccruedYield,
          apy_snapshot: result.estimatedAPY,
          last_refreshed_at: new Date().toISOString(),
        })
        .eq('id', existingPos.id);
      positionId = existingPos.id;
    } else {
      const { data: newPos, error: posErr } = await supabase
        .from('yield_positions')
        .insert({
          user_id: session.user.id,
          enterprise_id: enterpriseId,
          wallet_id: wallet?.id ?? null,
          protocol,
          chain,
          underlying_token: token,
          yield_token: result.yieldToken,
          yield_token_balance: result.tokensReceived,
          deposited_amount: parseFloat(amount),
          current_value_usd: parseFloat(amount),
          accrued_yield_usd: 0,
          apy_snapshot: result.estimatedAPY,
          last_refreshed_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (posErr) throw new Error(posErr.message);
      positionId = newPos!.id;
    }

    // Update transaction to completed
    await supabase
      .from('yield_transactions')
      .update({
        position_id: positionId,
        tx_hash: result.txHash,
        status: 'completed',
        executed_at: new Date().toISOString(),
        metadata: {
          providerRef: result.providerRef,
          yieldToken: result.yieldToken,
          ...(slippage && {
            estimated_slippage_bps: slippage.estimated_slippage_bps,
            pool_liquidity_usd: slippage.pool_liquidity_usd,
            slippage_severity: slippage.severity,
            user_acknowledged_slippage: slippage.user_acknowledged,
            transaction_size_usd: parseFloat(amount),
          }),
        },
      })
      .eq('id', tx.id);

    await writeAuditLog({
      userId: session.user.id,
      action: 'yield_deposit',
      entityType: 'yield_position',
      entityId: positionId,
      details: { protocol, token, amount, txHash: result.txHash },
    });

    markPolicyEvaluationExecuted(supabase, {
      movementId: tx.id,
      enterpriseId: enterpriseId as string,
      executionRef: result.txHash,
    }).catch(() => {});

    return NextResponse.json({
      data: {
        transactionId: tx.id,
        positionId,
        ...result,
      },
    }, { status: 201 });
  } catch (err) {
    // Update transaction to failed
    await supabase
      .from('yield_transactions')
      .update({
        status: 'failed',
        error_message: (err as Error).message,
      })
      .eq('id', tx.id);

    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
