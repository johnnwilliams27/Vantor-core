// src/lib/test-mode/seed/transactions.ts
import { SeedContext, daysAgo, daysFromNow, rand, randInt, pick, ethHash, solHash } from './helpers';
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

  const { data: txns, error: txErr } = await supabase
    .from('transactions')
    .insert(txnRows)
    .select('id, wallet_id, chain, direction');
  if (txErr) throw new Error(`seedTransactions: transactions insert failed: ${txErr.message}`);

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

  // 15 ad-hoc transfers (first is always failed to guarantee transfer_attempts has data)
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
      status: i === 0 ? 'failed' : pick(['completed', 'completed', 'completed', 'processing', 'failed']),
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

  const { data: transfers, error: trErr } = await supabase
    .from('transfers')
    .insert(transferRows)
    .select('id, status');
  if (trErr) throw new Error(`seedTransactions: transfers insert failed: ${trErr.message}`);

  // Transfer attempts for failed transfers
  console.log(`[seedTransactions] inserted ${transferRows.length} transfers, select returned ${transfers?.length ?? 0} rows`);
  const failedTransfers = transfers?.filter(p => p.status === 'failed') || [];
  console.log(`[seedTransactions] found ${failedTransfers.length} failed transfers`);
  if (failedTransfers.length) {
    const attemptRows = failedTransfers.flatMap(p => [
      { transfer_id: p.id, attempt_no: 1, status: 'failed', error: 'Insufficient gas', attempted_at: daysAgo(randInt(2, 10)) },
      { transfer_id: p.id, attempt_no: 2, status: 'failed', error: 'Nonce too low', attempted_at: daysAgo(randInt(1, 5)) },
    ]);
    console.log(`[seedTransactions] inserting ${attemptRows.length} transfer_attempts`);
    const { error: taErr } = await supabase.from('transfer_attempts').insert(attemptRows);
    if (taErr) throw new Error(`seedTransactions: transfer_attempts insert failed: ${taErr.message}`);
    console.log(`[seedTransactions] transfer_attempts insert succeeded`);
  } else {
    console.log(`[seedTransactions] WARNING: no failed transfers found, skipping transfer_attempts`);
  }

  return {
    transactionIds: txns?.map(t => t.id) || [],
    transferIds: transfers?.map(p => p.id) || [],
  };
}

export async function seedFiatPayments(ctx: SeedContext, bankAccountIds: string[]): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;
  if (!bankAccountIds.length) return;

  const externalBanks = [
    { name: 'First National Bank', routing: '021000021' },
    { name: 'Barclays Corporate', routing: '026002561' },
    { name: 'Deutsche Bank AG', routing: '021001033' },
    { name: 'Wells Fargo Commercial', routing: '121000248' },
    { name: 'HSBC Business Banking', routing: '022000020' },
  ];

  // fiat_payments.currency CHECK constraint (migration 0022) restricts to
  // these three. LATAM currencies live on fiat_transactions only.
  const currencies = ['USD', 'EUR', 'GBP'];

  const rows: any[] = [];

  // 5 completed payments
  for (let i = 0; i < 5; i++) {
    const bank = pick(externalBanks);
    const currency = pick(currencies);
    const executedDaysAgo = randInt(5, 60);
    const settledDaysAgo = executedDaysAgo - 2;
    rows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      from_bank_account_id: pick(bankAccountIds),
      to_bank_name: bank.name,
      to_account_number: String(randInt(10000000, 99999999)),
      to_routing_number: bank.routing,
      to_account_holder: pick(['Acme Corp', 'Global Suppliers Ltd', 'European Partners GmbH', 'Pacific Ventures LLC', 'Northfield Trading Co']),
      amount: rand(5000, 250000).toFixed(2),
      currency,
      status: 'completed',
      executed_at: daysAgo(executedDaysAgo),
      settled_at: daysAgo(settledDaysAgo),
      estimated_settlement: daysAgo(settledDaysAgo),
      memo: pick([null, 'Invoice settlement Q1', 'Supplier payment', 'Contract disbursement', null]),
      created_at: daysAgo(executedDaysAgo + 1),
    });
  }

  // 3 pending (executed, awaiting settlement)
  for (let i = 0; i < 3; i++) {
    const bank = pick(externalBanks);
    const currency = pick(currencies);
    const executedDaysAgo = randInt(1, 3);
    rows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      from_bank_account_id: pick(bankAccountIds),
      to_bank_name: bank.name,
      to_account_number: String(randInt(10000000, 99999999)),
      to_routing_number: bank.routing,
      to_account_holder: pick(['Tech Distributors Inc', 'Meridian Logistics', 'Atlantic Trade Co']),
      amount: rand(10000, 100000).toFixed(2),
      currency,
      status: 'pending',
      executed_at: daysAgo(executedDaysAgo),
      estimated_settlement: daysFromNow(2 - executedDaysAgo > 0 ? 2 - executedDaysAgo : 1),
      memo: pick([null, 'Q2 vendor payment', 'Service fee settlement']),
      created_at: daysAgo(executedDaysAgo),
    });
  }

  // 2 scheduled (future, not yet executed)
  for (let i = 0; i < 2; i++) {
    const bank = pick(externalBanks);
    const currency = pick(currencies);
    const scheduleDays = randInt(3, 14);
    rows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      from_bank_account_id: pick(bankAccountIds),
      to_bank_name: bank.name,
      to_account_number: String(randInt(10000000, 99999999)),
      to_routing_number: bank.routing,
      to_account_holder: pick(['Westgate Partners', 'Nordic Capital GmbH']),
      amount: rand(25000, 150000).toFixed(2),
      currency,
      status: 'pending',
      scheduled_for: daysFromNow(scheduleDays),
      memo: pick([null, 'Scheduled quarterly payment', 'Advance payment per contract']),
      created_at: daysAgo(randInt(1, 3)),
    });
  }

  const { error: fpErr } = await supabase.from('fiat_payments').insert(rows);
  if (fpErr) throw new Error(`seedFiatPayments: fiat_payments insert failed: ${fpErr.message}`);
}
