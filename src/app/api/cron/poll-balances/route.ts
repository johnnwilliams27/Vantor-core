import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchEthereumBalances } from '@/lib/blockchain/ethereum/balances';
import { fetchSolanaBalances } from '@/lib/blockchain/solana/balances';
import type { Wallet } from '@/types/database';
import type { TokenBalance } from '@/types/blockchain';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: wallets, error } = await supabase
    .from('wallets')
    .select('*');

  if (error) {
    console.error('[cron/balances]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!wallets?.length) {
    return NextResponse.json({ updated: 0 });
  }

  let updated = 0;
  const now = new Date().toISOString();

  for (const wallet of wallets as Wallet[]) {
    try {
      let balances: TokenBalance[] = [];

      if (wallet.chain === 'ethereum') {
        balances = await fetchEthereumBalances(wallet.address);
      } else if (wallet.chain === 'solana') {
        balances = await fetchSolanaBalances(wallet.address);
      }

      for (const b of balances) {
        // Upsert balance
        await supabase.from('wallet_balances').upsert(
          {
            wallet_id: wallet.id,
            token: b.token,
            balance: b.balance,
            usd_value: b.usdValue ?? null,
            last_updated: now,
          },
          { onConflict: 'wallet_id,token' }
        );

        // Insert snapshot for historical charts
        await supabase.from('balance_snapshots').insert({
          wallet_id: wallet.id,
          token: b.token,
          balance: b.balance,
          usd_value: b.usdValue ?? null,
          snapped_at: now,
        });

        updated++;
      }
    } catch (err) {
      console.error(`[cron/balances] wallet ${wallet.id}:`, err);
    }
  }

  console.log(`[cron/balances] updated=${updated} wallets=${wallets.length}`);
  return NextResponse.json({ updated, wallets: wallets.length });
}
