// src/lib/test-mode/seed/wallets.ts
import { SeedContext } from './helpers';

const TEST_WALLETS = [
  { chain: 'ethereum', address: '0xTEST1111111111111111111111111111111111aa', label: 'Treasury Main', tokens: [{ token: 'USDC', balance: '1000000.00' }, { token: 'USDT', balance: '175000.00' }] },
  { chain: 'ethereum', address: '0xTEST2222222222222222222222222222222222bb', label: 'Operations', tokens: [{ token: 'USDC', balance: '150000.00' }] },
  { chain: 'ethereum', address: '0xTEST3333333333333333333333333333333333cc', label: 'Reserve', tokens: [{ token: 'USDC', balance: '500000.00' }] },
  { chain: 'solana', address: 'TESTso1ana1111111111111111111111111111111111', label: 'Solana Treasury', tokens: [{ token: 'USDC', balance: '275000.00' }] },
  { chain: 'solana', address: 'TESTso1ana2222222222222222222222222222222222', label: 'Solana Payments', tokens: [{ token: 'USDT', balance: '50000.00' }] },
];

export interface WalletIds {
  ethWallets: { id: string; address: string }[];
  solWallets: { id: string; address: string }[];
  allWalletIds: string[];
}

export async function seedWallets(ctx: SeedContext): Promise<WalletIds> {
  const { supabase, enterpriseId, userId } = ctx;
  const now = new Date().toISOString();

  // Insert wallets
  const walletRows = TEST_WALLETS.map(w => ({
    user_id: userId,
    enterprise_id: enterpriseId,
    chain: w.chain,
    address: w.address,
    label: w.label,
    verified_at: now,
  }));

  const { data: wallets } = await supabase
    .from('wallets')
    .insert(walletRows)
    .select('id, chain, address');

  if (!wallets?.length) return { ethWallets: [], solWallets: [], allWalletIds: [] };

  // Insert balances
  const balanceRows: any[] = [];
  for (const wallet of wallets) {
    const def = TEST_WALLETS.find(w => w.address === wallet.address);
    if (!def) continue;
    for (const tok of def.tokens) {
      balanceRows.push({
        wallet_id: wallet.id,
        enterprise_id: enterpriseId,
        token: tok.token,
        balance: tok.balance,
        usd_value: tok.balance,
      });
    }
  }
  if (balanceRows.length) {
    await supabase.from('wallet_balances').insert(balanceRows);
  }

  // Insert 180-day balance snapshots
  const snapshots: any[] = [];
  for (const wallet of wallets) {
    const def = TEST_WALLETS.find(w => w.address === wallet.address);
    if (!def) continue;
    for (const tok of def.tokens) {
      const baseBalance = parseFloat(tok.balance);
      for (let d = 180; d >= 0; d--) {
        const variance = 1 + Math.sin(d * 0.3) * 0.06 + (180 - d) * 0.001;
        const bal = (baseBalance * 0.85 * variance).toFixed(2);
        snapshots.push({
          wallet_id: wallet.id,
          enterprise_id: enterpriseId,
          token: tok.token,
          balance: bal,
          usd_value: bal,
          snapped_at: new Date(Date.now() - d * 86_400_000).toISOString(),
        });
      }
    }
  }

  // Batch insert snapshots in chunks of 500
  for (let i = 0; i < snapshots.length; i += 500) {
    await supabase.from('balance_snapshots').insert(snapshots.slice(i, i + 500));
  }

  const ethWallets = wallets.filter(w => w.chain === 'ethereum').map(w => ({ id: w.id, address: w.address }));
  const solWallets = wallets.filter(w => w.chain === 'solana').map(w => ({ id: w.id, address: w.address }));

  return {
    ethWallets,
    solWallets,
    allWalletIds: wallets.map(w => w.id),
  };
}
