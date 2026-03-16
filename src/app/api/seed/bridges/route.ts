import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

/**
 * POST /api/seed/bridges
 * Seeds mock bridge history entries into bridge_transfers table.
 */
export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data: wallets } = await supabase
    .from('wallets')
    .select('id, chain')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(2);

  const ethWallet = wallets?.find((w) => w.chain === 'ethereum');
  const solWallet = wallets?.find((w) => w.chain === 'solana');

  if (!ethWallet && !solWallet) {
    return NextResponse.json({ error: 'No wallets found — connect a wallet first' }, { status: 400 });
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const mockBridges = [
    {
      token: 'USDC', amount: 250000, received_amount: 250000, bridge_fee: 0,
      from_chain: 'ethereum', to_chain: 'solana', provider: 'cctp',
      from_wallet_id: ethWallet?.id ?? null, to_wallet_id: solWallet?.id ?? null,
      status: 'completed', slippage_bps: 2, estimated_arrival_minutes: 15,
      tx_hash: `0xcctp${Math.random().toString(36).slice(2, 14)}`,
      executed_at: new Date(now - 2 * day).toISOString(),
      created_at: new Date(now - 2 * day).toISOString(),
    },
    {
      token: 'USDT', amount: 100000, received_amount: 99998.50, bridge_fee: 1.50,
      from_chain: 'solana', to_chain: 'ethereum', provider: 'layerzero',
      from_wallet_id: solWallet?.id ?? null, to_wallet_id: ethWallet?.id ?? null,
      status: 'completed', slippage_bps: 3, estimated_arrival_minutes: 12,
      tx_hash: `0xlz${Math.random().toString(36).slice(2, 14)}`,
      executed_at: new Date(now - 5 * day).toISOString(),
      created_at: new Date(now - 5 * day).toISOString(),
    },
    {
      token: 'USDC', amount: 500000, received_amount: 500000, bridge_fee: 0,
      from_chain: 'solana', to_chain: 'ethereum', provider: 'cctp',
      from_wallet_id: solWallet?.id ?? null, to_wallet_id: ethWallet?.id ?? null,
      status: 'completed', slippage_bps: 1, estimated_arrival_minutes: 20,
      tx_hash: `0xcctp${Math.random().toString(36).slice(2, 14)}`,
      executed_at: new Date(now - 8 * day).toISOString(),
      created_at: new Date(now - 8 * day).toISOString(),
    },
    {
      token: 'PYUSD', amount: 75000, received_amount: 74998, bridge_fee: 2.00,
      from_chain: 'ethereum', to_chain: 'solana', provider: 'layerzero',
      from_wallet_id: ethWallet?.id ?? null, to_wallet_id: solWallet?.id ?? null,
      status: 'pending', slippage_bps: 4, estimated_arrival_minutes: 10,
      tx_hash: `0xlz${Math.random().toString(36).slice(2, 14)}`,
      executed_at: new Date(now - 1 * day).toISOString(),
      created_at: new Date(now - 1 * day).toISOString(),
    },
    {
      token: 'USDC', amount: 1000000, received_amount: 1000000, bridge_fee: 0,
      from_chain: 'ethereum', to_chain: 'solana', provider: 'cctp',
      from_wallet_id: ethWallet?.id ?? null, to_wallet_id: solWallet?.id ?? null,
      status: 'completed', slippage_bps: 5, estimated_arrival_minutes: 15,
      tx_hash: `0xcctp${Math.random().toString(36).slice(2, 14)}`,
      executed_at: new Date(now - 12 * day).toISOString(),
      created_at: new Date(now - 12 * day).toISOString(),
    },
    {
      token: 'USDT', amount: 50000, received_amount: null, bridge_fee: 1.50,
      from_chain: 'ethereum', to_chain: 'solana', provider: 'layerzero',
      from_wallet_id: ethWallet?.id ?? null, to_wallet_id: solWallet?.id ?? null,
      status: 'failed', slippage_bps: null, estimated_arrival_minutes: 10,
      error_message: 'LayerZero relayer timeout',
      tx_hash: `0xlz${Math.random().toString(36).slice(2, 14)}`,
      executed_at: new Date(now - 3 * day).toISOString(),
      created_at: new Date(now - 3 * day).toISOString(),
    },
  ];

  const rows = mockBridges.map((b) => ({
    user_id: session.user.id,
    enterprise_id: enterpriseId,
    metadata: { mock: true },
    ...b,
  }));

  const { error } = await supabase.from('bridge_transfers').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: { seeded: rows.length } }, { status: 201 });
}
