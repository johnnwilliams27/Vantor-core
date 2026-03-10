import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchSolanaBalances } from '@/lib/blockchain/solana/balances';
import { fetchEthereumBalances } from '@/lib/blockchain/ethereum/balances';
import type { Wallet } from '@/types/database';

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: wallets, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!wallets?.length) return NextResponse.json({ data: [] });

  const now = new Date().toISOString();
  const allBalances: object[] = [];

  for (const wallet of wallets as Wallet[]) {
    try {
      const balances =
        wallet.chain === 'solana'
          ? await fetchSolanaBalances(wallet.address)
          : await fetchEthereumBalances(wallet.address);

      for (const b of balances) {
        await supabase.from('wallet_balances').upsert(
          { wallet_id: wallet.id, token: b.token, balance: b.balance, usd_value: b.usdValue ?? null, last_updated: now },
          { onConflict: 'wallet_id,token' }
        );
        allBalances.push({ walletId: wallet.id, walletAddress: wallet.address, chain: wallet.chain, ...b });
      }
    } catch (err) {
      console.error(`[balances/refresh] wallet ${wallet.id}:`, err);
    }
  }

  return NextResponse.json({ data: allBalances });
}
