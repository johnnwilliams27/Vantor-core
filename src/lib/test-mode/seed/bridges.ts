// src/lib/test-mode/seed/bridges.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash } from './helpers';
import type { WalletIds } from './wallets';

export async function seedBridges(ctx: SeedContext, walletIds: WalletIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  if (!walletIds.ethWallets.length || !walletIds.solWallets.length) return;

  const bridgeRows: any[] = [];
  for (let i = 0; i < 6; i++) {
    const ethToSol = Math.random() > 0.5;
    const fromWallet = ethToSol ? pick(walletIds.ethWallets) : pick(walletIds.solWallets);
    const toWallet = ethToSol ? pick(walletIds.solWallets) : pick(walletIds.ethWallets);
    const amount = rand(25000, 200000).toFixed(2);
    const feePct = rand(0.001, 0.005);
    const fee = (parseFloat(amount) * feePct).toFixed(2);
    const received = (parseFloat(amount) - parseFloat(fee)).toFixed(2);
    const status = pick(['completed', 'completed', 'completed', 'completed', 'failed']);

    bridgeRows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      from_wallet_id: fromWallet.id,
      to_wallet_id: toWallet.id,
      token: pick(['USDC', 'USDT']),
      amount,
      received_amount: status === 'completed' ? received : null,
      bridge_fee: fee,
      from_chain: ethToSol ? 'ethereum' : 'solana',
      to_chain: ethToSol ? 'solana' : 'ethereum',
      provider: pick(['cctp', 'layerzero']),
      tx_hash: ethHash(),
      status,
      slippage_bps: randInt(1, 10),
      estimated_arrival_minutes: randInt(5, 30),
      error_message: status === 'failed' ? 'Bridge timeout — destination chain congestion' : null,
      metadata: { mock: true },
      executed_at: daysAgo(randInt(1, 75)),
      created_at: daysAgo(randInt(1, 80)),
    });
  }

  const { error } = await supabase.from('bridge_transfers').insert(bridgeRows);
  if (error) throw new Error(`seedBridges: bridge_transfers insert failed: ${error.message}`);
}
