// src/lib/test-mode/seed/transactions.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

export interface TransactionIds {
  transactionIds: string[];
  transferIds: string[];
}

export async function seedTransactions(ctx: SeedContext, walletIds: WalletIds, invoiceIds: string[]): Promise<TransactionIds> {
  const { supabase, enterpriseId, userId } = ctx;
  if (!walletIds.ethWallets.length || !walletIds.solWallets.length) {
    return { transactionIds: [], transferIds: [] };
  }

  // Generate ~35 on-chain transactions over 90 days
  const txnRows: any[] = [];
  for (let d = 90; d >= 1; d--) {
    if (Math.random() > 0.4) continue;
    const count = Math.random() > 0.85 ? 2 : 1;
    for (let c = 0; c < count; c++) {
      const isEth = Math.random() > 0.35;
      const wallet = isEth ? pick(walletIds.ethWallets) : pick(walletIds.solWallets);
      const isOutbound = Math.random() > 0.3;
      const amount = isOutbound ? rand(5000, 150000).toFixed(2) : rand(50000, 500000).toFixed(2);
      const fee = isEth ? rand(5, 50).toFixed(2) : rand(0.001, 0.01).toFixed(6);

      txnRows.push({
        user_id: userId,
        enterprise_id: enterpriseId,
        wallet_id: wallet.id,
        chain: isEth ? 'ethereum' : 'solana',
        tx_hash: isEth ? ethHash() : solHash(),
        block_number: isEth ? randInt(19_000_000, 21_500_000) : randInt(250_000_000, 300_000_000),
        from_address: isOutbound ? wallet.address : (isEth ? `0xEXT${ethHash().slice(4)}` : `EXT${solHash().slice(3)}`),
        to_address: isOutbound ? (isEth ? `0xEXT${ethHash().slice(4)}` : `EXT${solHash().slice(3)}`) : wallet.address,
        token: pick(['USDC', 'USDT']),
        amount,
        fee,
        status: 'confirmed',
        direction: isOutbound ? 'outbound' : 'inbound',
        timestamp: daysAgo(d),
      });
    }
  }

  const { data: txns } = await supabase
    .from('transactions')
    .insert(txnRows)
    .select('id, wallet_id, chain, direction');

  // Generate transfers
  const transferRows: any[] = [];

  // Invoice-linked transfers (for first 12 paid invoices)
  const paidInvoiceIds = invoiceIds.slice(0, 12);
  for (const invoiceId of paidInvoiceIds) {
    const wallet = pick([...walletIds.ethWallets, ...walletIds.solWallets]);
    const isEth = walletIds.ethWallets.some(w => w.id === wallet.id);
    transferRows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      invoice_id: invoiceId,
      from_wallet_id: wallet.id,
      to_address: `0xTESTvendor${ethHash().slice(14)}`,
      chain: isEth ? 'ethereum' : 'solana',
      token: pick(['USDC', 'USDT']),
      amount: rand(2000, 120000).toFixed(2),
      status: 'completed',
      tx_hash: isEth ? ethHash() : solHash(),
      executed_at: daysAgo(randInt(5, 80)),
      created_at: daysAgo(randInt(10, 85)),
    });
  }

  // 15 ad-hoc completed transfers
  for (let i = 0; i < 15; i++) {
    const wallet = pick([...walletIds.ethWallets, ...walletIds.solWallets]);
    const isEth = walletIds.ethWallets.some(w => w.id === wallet.id);
    transferRows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      from_wallet_id: wallet.id,
      to_address: `0xEXT${ethHash().slice(4)}`,
      chain: isEth ? 'ethereum' : 'solana',
      token: pick(['USDC', 'USDT']),
      amount: rand(3000, 80000).toFixed(2),
      status: pick(['completed', 'completed', 'completed', 'processing', 'failed']),
      tx_hash: isEth ? ethHash() : solHash(),
      executed_at: daysAgo(randInt(1, 75)),
      created_at: daysAgo(randInt(5, 80)),
    });
  }

  // 5 scheduled future transfers
  for (let i = 0; i < 5; i++) {
    const wallet = pick(walletIds.ethWallets);
    transferRows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      from_wallet_id: wallet.id,
      to_address: `0xTESTvendor${ethHash().slice(14)}`,
      chain: 'ethereum',
      token: 'USDC',
      amount: rand(5000, 100000).toFixed(2),
      status: 'pending',
      scheduled_for: new Date(Date.now() + (i + 1) * 7 * 86_400_000).toISOString(),
      created_at: daysAgo(randInt(1, 5)),
    });
  }

  const { data: transfers } = await supabase
    .from('transfers')
    .insert(transferRows)
    .select('id, status');

  // Transfer attempts for failed transfers
  const failedTransfers = transfers?.filter(p => p.status === 'failed') || [];
  if (failedTransfers.length) {
    const attemptRows = failedTransfers.flatMap(p => [
      { transfer_id: p.id, attempt_no: 1, status: 'failed', error: 'Insufficient gas', attempted_at: daysAgo(randInt(2, 10)) },
      { transfer_id: p.id, attempt_no: 2, status: 'failed', error: 'Nonce too low', attempted_at: daysAgo(randInt(1, 5)) },
    ]);
    await supabase.from('transfer_attempts').insert(attemptRows);
  }

  return {
    transactionIds: txns?.map(t => t.id) || [],
    transferIds: transfers?.map(p => p.id) || [],
  };
}
