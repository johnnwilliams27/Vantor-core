import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { applyWithdrawal } from '@/lib/yield/position-accounting';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import { fireInlineInsights } from '@/lib/insights/inline';

const confirmWithdrawSchema = z.object({
  positionId: z.string().uuid(),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  txHash: z.string().min(1),
  tokensRedeemed: z.number().positive(),
  isFullWithdrawal: z.boolean(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('withdraw from yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-deposit', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = confirmWithdrawSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { positionId, amount, txHash, tokensRedeemed, isFullWithdrawal } = parsed.data;
  const supabase = createAdminClient();

  // Check for duplicate txHash
  const { data: existingTx } = await supabase
    .from('yield_transactions')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existingTx) {
    return NextResponse.json({ error: 'Transaction already recorded' }, { status: 409 });
  }

  // Fetch position — must be active and owned by this user/enterprise
  const { data: position, error: posErr } = await supabase
    .from('yield_positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .single();

  if (posErr || !position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  // Compute accounting update via average cost basis
  const withdrawResult = applyWithdrawal(
    parseFloat(position.deposited_amount),
    parseFloat(position.yield_token_balance || '0'),
    parseFloat(position.current_value_usd),
    parseFloat(amount),
    tokensRedeemed,
  );

  // Treat as full withdrawal if caller flagged it or accounting determined it
  const effectiveFullWithdrawal = isFullWithdrawal || withdrawResult.isFullWithdrawal;

  if (effectiveFullWithdrawal) {
    const { error: updateErr } = await supabase
      .from('yield_positions')
      .update({
        is_active: false,
        deposited_amount: 0,
        yield_token_balance: 0,
        current_value_usd: 0,
        accrued_yield_usd: 0,
        metadata: {
          ...(typeof position.metadata === 'object' ? position.metadata : {}),
          realized_yield_usd: withdrawResult.realizedYield,
          closed_at: new Date().toISOString(),
        },
      })
      .eq('id', positionId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  } else {
    const newCurrentValue = parseFloat(position.current_value_usd) - parseFloat(amount);
    const { error: updateErr } = await supabase
      .from('yield_positions')
      .update({
        deposited_amount: withdrawResult.newDepositedAmount,
        yield_token_balance: withdrawResult.newYieldTokenBalance,
        current_value_usd: newCurrentValue,
        accrued_yield_usd: Math.max(0, newCurrentValue - withdrawResult.newDepositedAmount),
        last_refreshed_at: new Date().toISOString(),
      })
      .eq('id', positionId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Insert yield_transaction with status 'completed'
  const { error: txErr } = await supabase
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
      tx_hash: txHash,
      status: 'completed',
      executed_at: new Date().toISOString(),
      metadata: {
        tokensRedeemed,
        realizedYield: withdrawResult.realizedYield,
        isFullWithdrawal: effectiveFullWithdrawal,
        onChain: true,
      },
    });

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'yield_withdraw',
    entityType: 'yield_position',
    entityId: positionId,
    details: {
      protocol: position.protocol,
      token: position.underlying_token,
      amount,
      txHash,
      realizedYield: withdrawResult.realizedYield,
      isFullWithdrawal: effectiveFullWithdrawal,
      onChain: true,
    },
  });

  // Fire insight detectors inline (non-blocking). Skip for non-enterprise
  // users — detectors require enterprise scope to be meaningful.
  if (enterpriseId) {
    fireInlineInsights(supabase, {
      enterpriseId,
      userId: session.user.id,
      trigger: 'yield_withdraw',
    }).catch(() => {});
  }

  return NextResponse.json({ positionId, txHash }, { status: 200 });
}
