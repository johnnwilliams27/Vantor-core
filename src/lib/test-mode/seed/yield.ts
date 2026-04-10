// src/lib/test-mode/seed/yield.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

export async function seedYield(ctx: SeedContext, walletIds: WalletIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const positions = [
    { protocol: 'aave_v3', chain: 'ethereum', token: 'USDC', yieldToken: 'aUSDC', deposited: 250000, apy: 4.8, wallets: walletIds.ethWallets },
    { protocol: 'morpho_reservoir', chain: 'ethereum', token: 'USDC', yieldToken: 'bbqUSDCreservoir', deposited: 150000, apy: 7.0, wallets: walletIds.ethWallets },
    { protocol: 'kamino', chain: 'solana', token: 'USDC', yieldToken: 'kUSDC', deposited: 100000, apy: 6.1, wallets: walletIds.solWallets },
    { protocol: 'ondo', chain: 'ethereum', token: 'USDC', yieldToken: 'OUSG', deposited: 500000, apy: 4.5, wallets: walletIds.ethWallets },
  ];

  for (const pos of positions) {
    if (!pos.wallets.length) continue;
    const wallet = pick(pos.wallets);
    const daysActive = randInt(30, 120);
    const accrued = (pos.deposited * (pos.apy / 100) * (daysActive / 365)).toFixed(2);
    const currentValue = (pos.deposited + parseFloat(accrued)).toFixed(2);

    const { data: position } = await supabase
      .from('yield_positions')
      .insert({
        user_id: userId, enterprise_id: enterpriseId, wallet_id: wallet.id,
        protocol: pos.protocol, chain: pos.chain, underlying_token: pos.token,
        yield_token: pos.yieldToken, deposited_amount: pos.deposited.toFixed(2),
        current_value_usd: currentValue, accrued_yield_usd: accrued,
        apy_snapshot: pos.apy, last_refreshed_at: new Date().toISOString(),
        is_active: true, metadata: { mock: true }, created_at: daysAgo(daysActive),
      })
      .select('id')
      .single();

    if (!position) continue;

    const isEth = pos.chain === 'ethereum';
    await supabase.from('yield_transactions').insert({
      user_id: userId, enterprise_id: enterpriseId, position_id: position.id,
      protocol: pos.protocol, chain: pos.chain, tx_type: 'deposit',
      underlying_token: pos.token, amount: pos.deposited.toFixed(2),
      amount_usd: pos.deposited.toFixed(2), tx_hash: isEth ? ethHash() : solHash(),
      status: 'completed', executed_at: daysAgo(daysActive), created_at: daysAgo(daysActive),
    });

    if (Math.random() > 0.5) {
      const withdrawAmount = rand(10000, pos.deposited * 0.3).toFixed(2);
      await supabase.from('yield_transactions').insert({
        user_id: userId, enterprise_id: enterpriseId, position_id: position.id,
        protocol: pos.protocol, chain: pos.chain, tx_type: 'withdraw',
        underlying_token: pos.token, amount: withdrawAmount, amount_usd: withdrawAmount,
        tx_hash: isEth ? ethHash() : solHash(), status: 'completed',
        executed_at: daysAgo(randInt(5, daysActive - 5)), created_at: daysAgo(randInt(5, daysActive - 5)),
      });
    }
  }
}
