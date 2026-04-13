import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { writeAuditLog } from '@/lib/audit/logger';
import { updateBalancesAfterRamp } from '@/lib/balances/update-after-movement';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { recordUsageFee } from '@/lib/billing/usage';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import {
  buildGateService,
  mapRampToMovement,
  GateError,
  mapGateErrorToHttp,
  type GateActor,
} from '@/lib/policy/gate';
import { markPolicyEvaluationExecuted } from '@/lib/policy/persistence/persist-evaluation';

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  bankAccountId: z.string().uuid(),
  cryptoToken: z.enum(['USDC', 'USDT']),
  cryptoAmount: z.number().positive(),
  fiatAmount: z.number().positive(),
  fiatCurrency: z.string().default('USD'),
  exchangeRate: z.number().positive(),
  feeAmount: z.number().min(0),
  memo: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('execute ramps'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();

  // Verify bank account belongs to user
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, stripe_fc_account_id, institution_name')
    .eq('id', parsed.data.bankAccountId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .single();

  if (!bankAccount) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });

  // Find the user's first active wallet so the mapper has an address to
  // attach to the chain-side endpoint. Not strictly required for the engine,
  // but lets rules filter by wallet later.
  const { data: userWallet } = await supabase
    .from('wallets')
    .select('id, address')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1)
    .maybeSingle();

  // ─── Policy gate ───────────────────────────────────────────────────
  const movement = mapRampToMovement(
    {
      direction: parsed.data.direction,
      cryptoToken: parsed.data.cryptoToken,
      cryptoAmount: String(parsed.data.cryptoAmount),
      fiatCurrency: parsed.data.fiatCurrency,
      fiatAmount: String(parsed.data.fiatAmount),
      bankAccountId: parsed.data.bankAccountId,
      walletAddress: userWallet?.address,
      memo: parsed.data.memo,
    },
    { userId: session.user.id, enterpriseId, fromAddress: userWallet?.address ?? '' },
  );

  // Insert fiat_transactions row as awaiting_approval up front so the gate
  // can tie denials/approvals to a concrete row id. Adapter call only runs
  // on allow_auto.
  const { data: fiatTx, error: insertErr } = await supabase
    .from('fiat_transactions')
    .insert({
      id: movement.id,
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      bank_account_id: parsed.data.bankAccountId,
      direction: parsed.data.direction,
      crypto_amount: parsed.data.cryptoAmount,
      crypto_token: parsed.data.cryptoToken,
      fiat_amount: parsed.data.fiatAmount,
      fiat_currency: parsed.data.fiatCurrency,
      exchange_rate: parsed.data.exchangeRate,
      fee_amount: parsed.data.feeAmount,
      status: 'awaiting_approval',
      provider: 'bridge',
      memo: parsed.data.memo ?? null,
    })
    .select()
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  const gateService = buildGateService(supabase);
  const actor: GateActor = {
    user_id: session.user.id,
    role: session.user.role as GateActor['role'],
    enterprise_id: enterpriseId,
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
        .eq('enterprise_id', enterpriseId);
      await writeAuditLog({
        userId: session.user.id,
        action: (parsed.data.direction === 'onramp' ? 'onramp_blocked' : 'offramp_blocked') as any,
        entityType: 'fiat_transaction',
        entityId: fiatTx.id,
        details: { reason_code: err.reason_code, ...(err.details as Record<string, unknown>) },
      });
      const { status, body: errBody } = mapGateErrorToHttp(err);
      return NextResponse.json(errBody, { status });
    }
    throw err;
  }

  if (gateResult.verdict === 'require_approval') {
    await writeAuditLog({
      userId: session.user.id,
      action: (parsed.data.direction === 'onramp' ? 'onramp_requires_approval' : 'offramp_requires_approval') as any,
      entityType: 'fiat_transaction',
      entityId: fiatTx.id,
      details: {
        approval_request_id: gateResult.approval_request.id,
        chain_id: gateResult.approval_request.chain_id,
        direction: parsed.data.direction,
        cryptoToken: parsed.data.cryptoToken,
        cryptoAmount: parsed.data.cryptoAmount,
        fiatAmount: parsed.data.fiatAmount,
      },
    });
    return NextResponse.json(
      { data: fiatTx, approval_request: gateResult.approval_request },
      { status: 202 },
    );
  }

  // allow_auto: flip to pending → run adapter → finalize.
  const { error: flipErr } = await supabase
    .from('fiat_transactions')
    .update({ status: 'pending' })
    .eq('id', fiatTx.id)
    .eq('enterprise_id', enterpriseId);
  if (flipErr) {
    await supabase
      .from('fiat_transactions')
      .update({ status: 'denied', denial_reason: 'gate_update_failed' })
      .eq('id', fiatTx.id)
      .eq('enterprise_id', enterpriseId);
    return NextResponse.json(
      {
        reason_code: 'gate_update_failed',
        human_readable: 'Policy gate cleared the ramp but the status flip failed.',
        user_action: 'Retry the ramp.',
        details: { transaction_id: fiatTx.id },
      },
      { status: 500 },
    );
  }

  try {
    const mode = getIntegrationMode(session.user.subscription_tier);
    const adapter = getBankingAdapter(mode);
    const result = await adapter.executeRamp({
      direction: parsed.data.direction,
      cryptoToken: parsed.data.cryptoToken,
      cryptoAmount: parsed.data.cryptoAmount,
      fiatAmount: parsed.data.fiatAmount,
      fiatCurrency: parsed.data.fiatCurrency,
      exchangeRate: parsed.data.exchangeRate,
      feeAmount: parsed.data.feeAmount,
      bankAccountRef: bankAccount.stripe_fc_account_id ?? bankAccount.id,
    });

    const { data: updatedTx } = await supabase
      .from('fiat_transactions')
      .update({
        status: result.status,
        provider_transaction_id: result.providerTransactionId,
        settled_at: result.settledAt,
      })
      .eq('id', fiatTx.id)
      .eq('enterprise_id', enterpriseId)
      .select()
      .single();

    await recordUsageFee({
      enterpriseId,
      transactionType: 'ramp',
      transactionId: fiatTx.id,
      notionalAmountUsd: parsed.data.fiatAmount,
      collectedVia: 'bridge',
    });

    await updateBalancesAfterRamp({
      direction: parsed.data.direction,
      walletId: userWallet?.id,
      bankAccountId: parsed.data.bankAccountId,
      token: parsed.data.cryptoToken,
      cryptoAmount: parsed.data.cryptoAmount,
      fiatAmount: parsed.data.fiatAmount,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: parsed.data.direction === 'onramp' ? 'onramp_execute' : 'offramp_execute',
      entityType: 'fiat_transaction',
      entityId: fiatTx.id,
      details: {
        direction: parsed.data.direction,
        cryptoToken: parsed.data.cryptoToken,
        cryptoAmount: parsed.data.cryptoAmount,
        fiatAmount: parsed.data.fiatAmount,
        providerTxId: result.providerTransactionId,
      },
    });

    markPolicyEvaluationExecuted(supabase, {
      movementId: fiatTx.id,
      enterpriseId,
      executionRef: result.providerTransactionId ?? null,
    }).catch(() => {});

    return NextResponse.json({ data: updatedTx ?? fiatTx }, { status: 201 });
  } catch (err) {
    await supabase
      .from('fiat_transactions')
      .update({ status: 'failed' })
      .eq('id', fiatTx.id)
      .eq('enterprise_id', enterpriseId);
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
