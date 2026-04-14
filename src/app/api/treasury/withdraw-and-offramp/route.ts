import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getYieldAdapter } from '@/lib/yield/factory';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { updateWalletBalance, updateBankBalance } from '@/lib/balances/update-after-movement';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import type { YieldProtocolId } from '@/lib/yield/interface';
import {
  buildGateService,
  mapRampToMovement,
  GateError,
  mapGateErrorToHttp,
  type GateActor,
} from '@/lib/policy/gate';
import { markPolicyEvaluationExecuted } from '@/lib/policy/persistence/persist-evaluation';

const schema = z.object({
  positionId: z.string().uuid(),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Must be positive'),
  walletAddress: z.string().min(1).max(100),
  bankAccountId: z.string().uuid(),
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { positionId, amount, walletAddress, bankAccountId, fiatCurrency } = parsed.data;
  const supabase = createAdminClient();

  // 1. Fetch and validate position
  const { data: position, error: posErr } = await supabase
    .from('yield_positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (posErr || !position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  if (parseFloat(amount) > parseFloat(position.deposited_amount)) {
    return NextResponse.json({ error: 'Amount exceeds position balance' }, { status: 400 });
  }

  // 2. Validate bank account
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, institution_name, balance_currency')
    .eq('id', bankAccountId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (!bankAccount) {
    return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
  }

  // ─── Policy gate ───────────────────────────────────────────────────
  // This is a 2-leg flow (yield withdraw → offramp). We gate as a single
  // fiat_ramp(offramp) movement because the user-visible outflow is to the
  // bank; the yield step is an internal prerequisite. Rules specific to
  // yield withdrawal can still match on metadata.source_protocol.
  //
  // On require_approval or block, NEITHER leg runs — no adapter calls and
  // no side-effect inserts. Status on the single fiat_transactions row is
  // the source of truth until an approver acts (execution-on-approve is a
  // documented follow-up needing an executor registry).
  const movement = mapRampToMovement(
    {
      direction: 'offramp',
      cryptoToken: position.underlying_token,
      cryptoAmount: amount,
      fiatCurrency,
      fiatAmount: amount, // stablecoin 1:1 before FX
      bankAccountId,
      walletAddress,
    },
    { userId: session.user.id, enterpriseId: enterpriseId as string, fromAddress: walletAddress },
  );
  // Tag metadata with yield origin so policy rules can differentiate this
  // combined flow from a pure wallet→bank offramp.
  movement.metadata = {
    ...(movement.metadata ?? {}),
    combined_flow: 'withdraw_and_offramp',
    source_protocol: position.protocol,
    source_position_id: positionId,
  };

  const { data: fiatTx, error: fiatInsertErr } = await supabase
    .from('fiat_transactions')
    .insert({
      id: movement.id,
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      bank_account_id: bankAccountId,
      direction: 'offramp',
      crypto_amount: parseFloat(amount),
      crypto_token: position.underlying_token,
      fiat_amount: parseFloat(amount),
      fiat_currency: fiatCurrency,
      exchange_rate: 1,
      fee_amount: 0,
      status: 'awaiting_approval',
      provider: 'bridge',
    })
    .select()
    .single();
  if (fiatInsertErr) {
    return NextResponse.json({ error: fiatInsertErr.message }, { status: 500 });
  }

  const gateService = buildGateService(supabase);
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
        .from('fiat_transactions')
        .update({ status: 'denied', denial_reason: err.reason_code })
        .eq('id', fiatTx.id)
        .eq('enterprise_id', enterpriseId as string);
      await writeAuditLog({
        userId: session.user.id,
        action: 'offramp_blocked' as any,
        entityType: 'fiat_transaction',
        entityId: fiatTx.id,
        details: {
          reason_code: err.reason_code,
          combined_flow: 'withdraw_and_offramp',
          ...(err.details as Record<string, unknown>),
        },
      });
      const { status, body: errBody } = mapGateErrorToHttp(err);
      return NextResponse.json(errBody, { status });
    }
    throw err;
  }

  if (gateResult.verdict === 'require_approval') {
    await writeAuditLog({
      userId: session.user.id,
      action: 'offramp_requires_approval' as any,
      entityType: 'fiat_transaction',
      entityId: fiatTx.id,
      details: {
        approval_request_id: gateResult.approval_request.id,
        chain_id: gateResult.approval_request.chain_id,
        combined_flow: 'withdraw_and_offramp',
        amount,
        fiatCurrency,
      },
    });
    return NextResponse.json(
      { data: fiatTx, approval_request: gateResult.approval_request },
      { status: 202 },
    );
  }

  // allow_auto: flip fiat row to pending, then run both legs.
  const { error: flipErr } = await supabase
    .from('fiat_transactions')
    .update({ status: 'pending' })
    .eq('id', fiatTx.id)
    .eq('enterprise_id', enterpriseId as string);
  if (flipErr) {
    await supabase
      .from('fiat_transactions')
      .update({ status: 'denied', denial_reason: 'gate_update_failed' })
      .eq('id', fiatTx.id)
      .eq('enterprise_id', enterpriseId as string);
    return NextResponse.json(
      {
        reason_code: 'gate_update_failed',
        human_readable: 'Policy gate cleared the withdraw-and-offramp but the status flip failed.',
        user_action: 'Retry the operation.',
        details: { transaction_id: fiatTx.id },
      },
      { status: 500 },
    );
  }

  try {
    // 3. Withdraw from yield
    const adapter = getYieldAdapter(position.protocol as YieldProtocolId);
    const withdrawResult = await adapter.withdraw({
      token: position.underlying_token,
      amount,
      walletAddress,
      chain: position.chain,
      yieldToken: position.yield_token,
    });

    // Update position
    const remaining = parseFloat(position.deposited_amount) - parseFloat(amount);
    await supabase
      .from('yield_positions')
      .update({
        deposited_amount: Math.max(0, remaining),
        current_value_usd: Math.max(0, remaining),
        is_active: remaining > 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', positionId);

    // Record yield transaction (NOT gated separately — the combined
    // policy decision covered both legs).
    const { data: yieldTx } = await supabase
      .from('yield_transactions')
      .insert({
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        position_id: positionId,
        protocol: position.protocol,
        chain: position.chain,
        tx_type: 'withdraw',
        underlying_token: position.underlying_token,
        amount: parseFloat(amount),
        amount_usd: parseFloat(amount),
        tx_hash: withdrawResult.txHash,
        status: 'completed',
        executed_at: new Date().toISOString(),
        metadata: {
          orchestrated: true,
          next_step: 'offramp',
          fiatCurrency,
          combined_flow_tx_id: fiatTx.id,
        },
      })
      .select()
      .single();

    // 4. Off-ramp to fiat
    const mode = getIntegrationMode(session.user.subscription_tier);
    const bankingAdapter = getBankingAdapter(mode);
    const rampResult = await bankingAdapter.executeRamp({
      direction: 'offramp',
      cryptoToken: position.underlying_token,
      cryptoAmount: parseFloat(amount),
      fiatAmount: parseFloat(amount),
      fiatCurrency,
      exchangeRate: 1,
      feeAmount: 0,
      bankAccountRef: bankAccount.id,
    });

    // Finalize the single fiat_transactions row we inserted earlier.
    const { data: finalizedFiatTx } = await supabase
      .from('fiat_transactions')
      .update({
        status: rampResult.status,
        provider_transaction_id: rampResult.providerTransactionId,
        settled_at: rampResult.settledAt,
      })
      .eq('id', fiatTx.id)
      .eq('enterprise_id', enterpriseId as string)
      .select()
      .single();

    // 5. Update balances
    if (position.wallet_id) {
      await updateWalletBalance({
        walletId: position.wallet_id,
        token: position.underlying_token,
        delta: -parseFloat(amount),
      });
    }
    await updateBankBalance({
      bankAccountId,
      delta: parseFloat(amount),
    });

    // 6. Audit
    await writeAuditLog({
      userId: session.user.id,
      action: 'yield_withdraw',
      entityType: 'yield_position',
      entityId: positionId,
      details: {
        orchestrated: true,
        amount,
        protocol: position.protocol,
        fiatCurrency,
        bankAccountId,
        yieldTxId: yieldTx?.id,
        fiatTxId: fiatTx.id,
      },
    });

    // Mark the policy_evaluations row executed. Single gate movement
    // covered both legs; the movement.id === fiatTx.id by construction.
    markPolicyEvaluationExecuted(supabase, {
      movementId: fiatTx.id,
      enterpriseId: enterpriseId as string,
      executionRef: rampResult.providerTransactionId ?? withdrawResult.txHash ?? null,
    }).catch(() => {});

    return NextResponse.json({
      data: {
        yieldTransactionId: yieldTx?.id,
        fiatTransactionId: finalizedFiatTx?.id ?? fiatTx.id,
        withdrawTxHash: withdrawResult.txHash,
        rampProviderTxId: rampResult.providerTransactionId,
        fiatCurrency,
      },
    }, { status: 201 });
  } catch (err) {
    // One leg already ran? Mark the fiat row as failed so ops sees it.
    await supabase
      .from('fiat_transactions')
      .update({ status: 'failed' })
      .eq('id', fiatTx.id)
      .eq('enterprise_id', enterpriseId as string);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
