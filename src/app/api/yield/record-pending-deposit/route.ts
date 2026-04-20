import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import { recordPendingDepositInputSchema } from './schema';

/**
 * Record an on-chain deposit tx as "pending" the moment the wallet signs,
 * before the client waits for confirmation. If the browser dies during
 * waitForTransactionReceipt or /api/yield/confirm-deposit fails later, this
 * row + the tx hash is enough for a reconcile job (or a human) to resolve
 * the position. Idempotent on tx_hash. No policy gate — user already signed.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('deposit into yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-record-pending', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = recordPendingDepositInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { protocol, token, amount, chain, txHash } = parsed.data;
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('yield_transactions')
    .select('id, status')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { id: existing.id, status: existing.status, alreadyRecorded: true },
      { status: 200 },
    );
  }

  const { data: row, error } = await supabase
    .from('yield_transactions')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      protocol,
      chain,
      tx_type: 'deposit',
      underlying_token: token,
      amount: parseFloat(amount),
      amount_usd: parseFloat(amount),
      tx_hash: txHash,
      status: 'pending',
      metadata: { onChain: true, recordedAt: new Date().toISOString() },
    })
    .select('id')
    .single();

  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? 'Failed to record pending deposit' }, { status: 500 });
  }

  return NextResponse.json({ id: row.id, status: 'pending' }, { status: 201 });
}
