import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getBankingAdapter } from '@/lib/banking/factory';
import { writeAuditLog } from '@/lib/audit/logger';
import { updateWalletBalance } from '@/lib/balances/update-after-movement';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { isTestMode } from '@/lib/test-mode/helpers';
import { recordUsageFee } from '@/lib/billing/usage';

const schema = z.object({
  fromWalletId: z.string().uuid(),
  toWalletId: z.string().uuid(),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Must be positive'),
  fromChain: z.enum(['ethereum', 'solana']),
  toChain: z.enum(['ethereum', 'solana']),
  quoteData: z.record(z.unknown()),
  bridgeFee: z.string().optional(),
  slippageBps: z.number().optional(),
  slippage: z.object({
    estimated_slippage_bps: z.number(),
    pool_liquidity_usd: z.number(),
    severity: z.enum(['green', 'yellow', 'red']),
    user_acknowledged: z.boolean(),
  }).optional(),
}).refine((d) => d.fromChain !== d.toChain, {
  message: 'Source and destination chains must differ',
  path: ['toChain'],
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

  const { fromWalletId, toWalletId, token, amount, fromChain, toChain, quoteData, bridgeFee, slippageBps, slippage } = parsed.data;
  const supabase = createAdminClient();

  // Verify wallets belong to user
  const { data: fromWallet } = await supabase
    .from('wallets')
    .select('id, address, chain')
    .eq('id', fromWalletId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!fromWallet) return NextResponse.json({ error: 'Source wallet not found' }, { status: 404 });

  const { data: toWallet } = await supabase
    .from('wallets')
    .select('id, address, chain')
    .eq('id', toWalletId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!toWallet) return NextResponse.json({ error: 'Destination wallet not found' }, { status: 404 });

  const adapter = getBankingAdapter();

  try {
    const result = await adapter.executeBridge({
      token: token as any,
      amount,
      fromChain: fromChain as any,
      toChain: toChain as any,
      walletAddress: fromWallet.address,
      quoteData,
    });

    const fee = parseFloat(bridgeFee ?? '0');
    const receivedAmount = (parseFloat(amount) - fee).toFixed(6);

    // Insert into bridge_transfers table
    const { data: bridge, error } = await supabase
      .from('bridge_transfers')
      .insert({
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        from_wallet_id: fromWalletId,
        to_wallet_id: toWalletId,
        token,
        amount: parseFloat(amount),
        received_amount: parseFloat(receivedAmount),
        bridge_fee: fee,
        from_chain: fromChain,
        to_chain: toChain,
        provider: 'bridge',
        tx_hash: result.txHash,
        status: result.status === 'completed' ? 'completed' : 'pending',
        slippage_bps: slippageBps ?? null,
        estimated_arrival_minutes: result.estimatedArrivalMinutes,
        metadata: {
          ...quoteData,
          ...(slippage && {
            estimated_slippage_bps: slippage.estimated_slippage_bps,
            pool_liquidity_usd: slippage.pool_liquidity_usd,
            slippage_severity: slippage.severity,
            user_acknowledged_slippage: slippage.user_acknowledged,
          }),
        },
        executed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!isTestMode()) {
      await recordUsageFee({
        enterpriseId,
        transactionType: 'bridge',
        transactionId: bridge.id,
        notionalAmountUsd: parseFloat(amount),
      });
    }

    // Update balances: decrease on source, increase on destination
    await updateWalletBalance({
      walletId: fromWalletId,
      token,
      delta: -parseFloat(amount),
    });

    await updateWalletBalance({
      walletId: toWalletId,
      token,
      delta: parseFloat(receivedAmount),
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'bridge_execute' as any,
      entityType: 'bridge_transfer',
      entityId: bridge.id,
      details: {
        token,
        amount,
        fromChain,
        toChain,
        provider: 'bridge',
        txHash: result.txHash,
        estimatedArrivalMinutes: result.estimatedArrivalMinutes,
      },
    });

    return NextResponse.json({
      data: {
        ...bridge,
        estimatedArrivalMinutes: result.estimatedArrivalMinutes,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
