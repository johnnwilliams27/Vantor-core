import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { NotificationService } from '@/lib/notifications/service';
import { actionNotificationEmail } from '@/lib/notifications/email-templates';
import { updateBalancesAfterSwap } from '@/lib/balances/update-after-movement';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { recordUsageFee } from '@/lib/billing/usage';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const schema = z.object({
  walletId: z.string().uuid(),
  chain: z.enum(['ethereum', 'solana']),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  fromAmount: z.string(),
  toAmount: z.string(),
  quoteData: z.record(z.unknown()).refine((obj) => JSON.stringify(obj).length <= 10000, 'quoteData too large'),
  txHash: z.string().max(100).optional(),
  memo: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('execute swaps'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify wallet belongs to user
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('id', parsed.data.walletId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });

  const { data: swap, error } = await supabase
    .from('swaps')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      wallet_id: parsed.data.walletId,
      chain: parsed.data.chain,
      from_token: parsed.data.fromToken,
      to_token: parsed.data.toToken,
      from_amount: parsed.data.fromAmount,
      to_amount: parsed.data.toAmount,
      tx_hash: parsed.data.txHash ?? null,
      status: parsed.data.txHash ? 'completed' : 'pending',
      quote_data: parsed.data.quoteData,
      memo: parsed.data.memo ?? null,
      executed_at: parsed.data.txHash ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recordUsageFee({
    enterpriseId,
    transactionType: 'swap',
    transactionId: swap.id,
    notionalAmountUsd: parseFloat(parsed.data.fromAmount),
    collectedVia: 'bridge',
  });

  // Update wallet balances (mock fallback — real balances sync from chain)
  await updateBalancesAfterSwap({
    walletId: parsed.data.walletId,
    fromToken: parsed.data.fromToken,
    toToken: parsed.data.toToken,
    fromAmount: parseFloat(parsed.data.fromAmount),
    toAmount: parseFloat(parsed.data.toAmount),
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'swap_execute',
    entityType: 'swap',
    entityId: swap.id,
    details: {
      chain: swap.chain,
      fromToken: swap.from_token,
      toToken: swap.to_token,
      fromAmount: swap.from_amount,
    },
  });

  const emailHtml = actionNotificationEmail({
    title: 'Swap Completed',
    details: [
      { label: 'From', value: `${swap.from_amount} ${swap.from_token}` },
      { label: 'To', value: `${swap.to_amount} ${swap.to_token}` },
      { label: 'Chain', value: swap.chain },
    ],
    ctaLabel: 'View Swap',
    ctaHref: '/swaps',
  });

  await NotificationService.notify({
    eventType: 'swap_completed',
    enterpriseId: session.user.enterprise_id!,
    title: 'Swap Completed',
    body: `Swapped ${swap.from_amount} ${swap.from_token} → ${swap.to_amount} ${swap.to_token} on ${swap.chain}`,
    link: '/swaps',
    metadata: {
      swapId: swap.id,
      _emailSubject: 'Swap Completed',
      _emailHtml: emailHtml,
    },
    actorId: session.user.id,
  }).catch(() => {});

  return NextResponse.json({ data: swap }, { status: 201 });
}
