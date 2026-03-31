// src/lib/test-mode/seed/swaps.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

export async function seedSwaps(ctx: SeedContext, walletIds: WalletIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;
  if (!walletIds.ethWallets.length || !walletIds.solWallets.length) return;

  const swapRows: any[] = [];
  for (let i = 0; i < 10; i++) {
    const isEth = Math.random() > 0.35;
    const wallet = isEth ? pick(walletIds.ethWallets) : pick(walletIds.solWallets);
    const buyUSDC = Math.random() > 0.5;
    const fromToken = buyUSDC ? 'USDT' : 'USDC';
    const toToken = buyUSDC ? 'USDC' : 'USDT';
    const fromAmount = rand(10000, 300000).toFixed(2);
    const slippageBps = randInt(1, 15);
    const rate = 1 + (Math.random() > 0.5 ? 1 : -1) * slippageBps / 10000;
    const toAmount = (parseFloat(fromAmount) * rate).toFixed(2);

    swapRows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      wallet_id: wallet.id,
      chain: isEth ? 'ethereum' : 'solana',
      from_token: fromToken,
      to_token: toToken,
      from_amount: fromAmount,
      to_amount: toAmount,
      rate: rate.toFixed(6),
      slippage_bps: slippageBps,
      tx_hash: isEth ? ethHash() : solHash(),
      status: pick(['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'pending', 'failed']),
      executed_at: daysAgo(randInt(1, 85)),
      created_at: daysAgo(randInt(1, 85)),
    });
  }

  await supabase.from('swaps').insert(swapRows);
}
