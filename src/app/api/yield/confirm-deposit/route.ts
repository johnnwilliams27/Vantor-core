import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import { fireInlineInsights } from '@/lib/insights/inline';

const confirmDepositSchema = z.object({
  protocol: z.string().min(1),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  chain: z.enum(['ethereum', 'solana']),
  txHash: z.string().min(1),
  yieldToken: z.string().min(1),
  tokensReceived: z.number().positive(),
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
  const parsed = confirmDepositSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { protocol, token, amount, walletAddress, chain, txHash, yieldToken, tokensReceived } = parsed.data;

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

  // Check for duplicate txHash
  const { data: existingTx } = await supabase
    .from('yield_transactions')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existingTx) {
    return NextResponse.json({ error: 'Transaction already recorded' }, { status: 409 });
  }

  // Look up wallet by address
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('address', walletAddress)
    .eq('user_id', session.user.id)
    .maybeSingle();

  // Upsert yield_position
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
    const newYieldTokenBalance = parseFloat(existingPos.yield_token_balance || '0') + tokensReceived;
    const newAccruedYield = Math.max(0, newCurrentValue - newDeposited);

    const { error: updateErr } = await supabase
      .from('yield_positions')
      .update({
        deposited_amount: newDeposited,
        yield_token_balance: newYieldTokenBalance,
        current_value_usd: newCurrentValue,
        accrued_yield_usd: newAccruedYield,
        last_refreshed_at: new Date().toISOString(),
      })
      .eq('id', existingPos.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
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
        yield_token: yieldToken,
        yield_token_balance: tokensReceived,
        deposited_amount: parseFloat(amount),
        current_value_usd: parseFloat(amount),
        accrued_yield_usd: 0,
        last_refreshed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (posErr || !newPos) return NextResponse.json({ error: posErr?.message ?? 'Failed to create position' }, { status: 500 });
    positionId = newPos.id;
  }

  // Insert yield_transaction with status 'completed'
  const { error: txErr } = await supabase
    .from('yield_transactions')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      position_id: positionId,
      protocol,
      chain,
      tx_type: 'deposit',
      underlying_token: token,
      amount: parseFloat(amount),
      amount_usd: parseFloat(amount),
      tx_hash: txHash,
      status: 'completed',
      executed_at: new Date().toISOString(),
      metadata: {
        yieldToken,
        tokensReceived,
        onChain: true,
      },
    });

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'yield_deposit',
    entityType: 'yield_position',
    entityId: positionId,
    details: { protocol, token, amount, txHash, onChain: true },
  });

  // Fire insight detectors inline (non-blocking)
  fireInlineInsights(supabase, {
    enterpriseId,
    userId: session.user.id,
    trigger: 'yield_deposit',
  }).catch(() => {});

  return NextResponse.json({ positionId, txHash }, { status: 201 });
}
