/**
 * Dev Seed Script — crypto-treasury
 *
 * Generates realistic dummy data:
 *   • 5 stablecoin wallets (3 Ethereum + 2 Solana)
 *   • 3 bank accounts
 *   • 4 ERP systems with vendors & invoices
 *   • 90 days of historical balance snapshots, transactions, payments, ramps
 *   • 90 days of prospective obligations, forecasts, AI recommendations
 *
 * Usage:
 *   npm run seed                           ← uses first user in DB
 *   npm run seed -- --email=you@example.com
 *   npm run seed -- --user-id=<uuid>
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Optional: Run migration 0007 first for Xero/NetSuite ERP support:
 *   npm run migrate supabase/migrations/0007_extend_erp_providers.sql
 */

import { createClient } from '@supabase/supabase-js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}
function ts(d: Date): string { return d.toISOString(); }
function dateStr(d: Date): string { return d.toISOString().split('T')[0]; }
function rand(min: number, max: number): number { return Math.random() * (max - min) + min; }
function randInt(min: number, max: number): number { return Math.floor(rand(min, max + 1)); }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function fmt2(n: number): number { return Math.round(n * 100) / 100; }

function b64creds(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function ethHash(): string {
  return '0x' + Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)).join('');
}
function solHash(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: 88 }, () =>
    chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Generate a daily balance series working backward from currentBalance over `days` days */
function balanceHistory(currentBalance: number, days: number): number[] {
  // Walk backward (each step subtracts a small daily drift)
  const series: number[] = [currentBalance];
  for (let i = 1; i <= days; i++) {
    const prev = series[series.length - 1];
    // Slight downward drift going back (account grew to current level)
    const drift = prev * rand(-0.005, 0.025);
    series.push(Math.max(prev * 0.5, prev - drift));
  }
  return series.reverse(); // oldest first (index 0 = 90 days ago)
}

// ─── Supabase client ────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Argument parsing ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const emailArg = args.find(a => a.startsWith('--email='))?.split('=')[1];
const userIdArg = args.find(a => a.startsWith('--user-id='))?.split('=')[1];

async function resolveUserId(): Promise<string> {
  if (userIdArg) return userIdArg;

  if (emailArg) {
    const { data, error } = await sb.from('user_profiles').select('id, email').eq('email', emailArg).single();
    if (error || !data) throw new Error(`User not found: ${emailArg}\n  Create an account via the app first.`);
    console.log(`✓ Seeding for ${data.email} (${data.id})`);
    return data.id;
  }

  const { data, error } = await sb.from('user_profiles').select('id, email').limit(1).single();
  if (error || !data) throw new Error('No users found.\n  Sign up in the app first, then run: npm run seed');
  console.log(`✓ Seeding for ${data.email} (${data.id})`);
  return data.id;
}

// ─── Clean ──────────────────────────────────────────────────────────────────

async function cleanUserData(userId: string) {
  console.log('\n🧹 Wiping previous seed data...');

  // Must delete in FK-safe order
  for (const t of ['simulation_runs', 'treasury_forecasts', 'ai_recommendations',
    'manual_obligations', 'treasury_rules', 'fiat_transactions', 'gl_postings']) {
    await sb.from(t).delete().eq('user_id', userId);
  }

  // payments cascade → payment_attempts
  await sb.from('payments').delete().eq('user_id', userId);

  // swaps
  await sb.from('swaps').delete().eq('user_id', userId);

  // balance_snapshots via wallet ids
  const { data: wids } = await sb.from('wallets').select('id').eq('user_id', userId);
  if (wids?.length) {
    await sb.from('balance_snapshots').delete().in('wallet_id', wids.map(w => w.id));
  }

  // invoices: null FK before deleting transactions
  await sb.from('invoices').update({ linked_tx_id: null }).eq('user_id', userId);
  await sb.from('transactions').delete().eq('user_id', userId);
  await sb.from('invoices').delete().eq('user_id', userId);

  // erp_configurations cascade → erp_vendors
  await sb.from('erp_configurations').delete().eq('user_id', userId);

  // bank_accounts, wallets (cascade → wallet_balances)
  await sb.from('bank_accounts').delete().eq('user_id', userId);
  await sb.from('wallets').delete().eq('user_id', userId);

  console.log('✓ Clean complete');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 crypto-treasury seed script\n');

  const userId = await resolveUserId();

  await cleanUserData(userId);

  // ════════════════════════════════════════════════════════
  // 1. WALLETS
  // ════════════════════════════════════════════════════════
  console.log('\n💼 Seeding wallets...');

  const { data: wallets, error: wErr } = await sb.from('wallets').insert([
    {
      user_id: userId,
      chain: 'ethereum',
      address: '0x742d35Cc6634C0532925a3b844Bc454d0a2c3e1f',
      label: 'Treasury Main',
      is_primary: true,
      verified_at: ts(daysAgo(60)),
    },
    {
      user_id: userId,
      chain: 'ethereum',
      address: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0e',
      label: 'Operations',
      is_primary: false,
      verified_at: ts(daysAgo(45)),
    },
    {
      user_id: userId,
      chain: 'ethereum',
      address: '0x2e988a386a799f506693793c6a5af6b54dfaabfb',
      label: 'Reserve',
      is_primary: false,
      verified_at: ts(daysAgo(30)),
    },
    {
      user_id: userId,
      chain: 'solana',
      address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
      label: 'Solana Treasury',
      is_primary: true,
      verified_at: ts(daysAgo(50)),
    },
    {
      user_id: userId,
      chain: 'solana',
      address: 'GKvqsuBMwKpQYBMFnKLKVJSHzWRRCFJiNL3qYhGV7Ls',
      label: 'Solana Payments',
      is_primary: false,
      verified_at: ts(daysAgo(20)),
    },
  ]).select();

  if (wErr || !wallets) throw new Error(`Wallet insert failed: ${wErr?.message}`);
  console.log(`✓ ${wallets.length} wallets`);

  const byLabel = (l: string) => wallets.find(w => w.label === l)!;
  const ethMain = byLabel('Treasury Main');
  const ethOps  = byLabel('Operations');
  const ethRes  = byLabel('Reserve');
  const solMain = byLabel('Solana Treasury');
  const solPay  = byLabel('Solana Payments');

  // Current balances (USD ≈ token 1:1 for stablecoins)
  const currentBalances: Record<string, Record<string, number>> = {
    [ethMain.id]: { USDC: 850_000, USDT: 150_000, PYUSD: 50_000 },
    [ethOps.id]:  { USDC: 125_000, USDT: 25_000 },
    [ethRes.id]:  { USDC: 500_000, PYUSD: 100_000 },
    [solMain.id]: { USDC: 275_000 },
    [solPay.id]:  { USDT: 50_000, PYUSD: 25_000 },
  };

  // ════════════════════════════════════════════════════════
  // 2. WALLET BALANCES (current)
  // ════════════════════════════════════════════════════════
  console.log('💰 Seeding wallet balances...');

  const balanceRows: object[] = [];
  for (const [walletId, tokens] of Object.entries(currentBalances)) {
    for (const [token, bal] of Object.entries(tokens)) {
      balanceRows.push({
        wallet_id: walletId,
        token,
        balance: fmt2(bal),
        usd_value: fmt2(bal),
        last_updated: ts(new Date()),
      });
    }
  }
  await sb.from('wallet_balances').insert(balanceRows);
  console.log(`✓ ${balanceRows.length} balance rows`);

  // ════════════════════════════════════════════════════════
  // 3. BANK ACCOUNTS
  // ════════════════════════════════════════════════════════
  console.log('\n🏦 Seeding bank accounts...');

  const { data: banks, error: bErr } = await sb.from('bank_accounts').insert([
    {
      user_id: userId,
      institution_name: 'JPMorgan Chase',
      account_name: 'Business Checking',
      account_type: 'checking',
      last4: '4321',
      routing_number: '021000021',
      currency: 'USD',
      current_balance: 450_000,
      balance_currency: 'USD',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(30)),
      plaid_item_id: 'mock-item-chase-001',
      plaid_account_id: 'mock-acct-chase-001',
    },
    {
      user_id: userId,
      institution_name: 'Silicon Valley Bank',
      account_name: 'Operating Account',
      account_type: 'checking',
      last4: '7890',
      routing_number: '121140399',
      currency: 'USD',
      current_balance: 1_200_000,
      balance_currency: 'USD',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(45)),
      plaid_item_id: 'mock-item-svb-001',
      plaid_account_id: 'mock-acct-svb-001',
    },
    {
      user_id: userId,
      institution_name: 'Mercury',
      account_name: 'Expense Account',
      account_type: 'checking',
      last4: '2468',
      routing_number: '084106768',
      currency: 'USD',
      current_balance: 85_000,
      balance_currency: 'USD',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(15)),
      plaid_item_id: 'mock-item-mercury-001',
      plaid_account_id: 'mock-acct-mercury-001',
    },
  ]).select();

  if (bErr || !banks) throw new Error(`Bank insert failed: ${bErr?.message}`);
  console.log(`✓ ${banks.length} bank accounts`);
  const [chaseBank, svbBank, mercuryBank] = banks;

  // ════════════════════════════════════════════════════════
  // 4. ERP CONFIGURATIONS
  // ════════════════════════════════════════════════════════
  console.log('\n🔗 Seeding ERP configurations...');

  const coreErpRows = [
    {
      user_id: userId,
      provider: 'sap',
      label: 'SAP S/4HANA Cloud',
      credentials: b64creds({
        apiUrl: 'https://my-sap.example.com/api/v1',
        clientId: 'sap_client_prod_001',
        clientSecret: 'sap_s3cr3t_abc123',
        companyCode: '1000',
      }),
      is_active: true,
      last_synced: ts(daysAgo(1)),
    },
    {
      user_id: userId,
      provider: 'oracle',
      label: 'Oracle Fusion Cloud',
      credentials: b64creds({
        apiUrl: 'https://oracle-fusion.example.com/fscmRestApi',
        clientId: 'oracle_client_prod_001',
        clientSecret: 'oracle_s3cr3t_xyz789',
        tenantId: 'acme-corp-tenant',
      }),
      is_active: true,
      last_synced: ts(daysAgo(2)),
    },
  ];

  const { data: coreErp } = await sb.from('erp_configurations').insert(coreErpRows).select();

  // Try xero + netsuite (requires migration 0007)
  const extErpRows = [
    {
      user_id: userId,
      provider: 'xero',
      label: 'Xero Accounting',
      credentials: b64creds({
        apiUrl: 'https://api.xero.com/api.xro/2.0',
        clientId: 'xero_client_prod_001',
        clientSecret: 'xero_s3cr3t_def456',
      }),
      is_active: true,
      last_synced: ts(daysAgo(3)),
    },
    {
      user_id: userId,
      provider: 'netsuite',
      label: 'NetSuite ERP',
      credentials: b64creds({
        apiUrl: 'https://acme.suitetalk.api.netsuite.com',
        clientId: 'ns_client_prod_001',
        clientSecret: 'ns_s3cr3t_ghi012',
        tenantId: 'ACME_CORP',
      }),
      is_active: true,
      last_synced: ts(daysAgo(4)),
    },
  ];

  const { data: extErp, error: extErr } = await sb.from('erp_configurations').insert(extErpRows).select();
  if (extErr) {
    console.log('  ⚠  Xero/NetSuite skipped (enum not extended).');
    console.log('     Run: npm run migrate supabase/migrations/0007_extend_erp_providers.sql');
  }

  const allErp = [...(coreErp ?? []), ...(extErp ?? [])];
  console.log(`✓ ${allErp.length} ERP configurations`);

  // ════════════════════════════════════════════════════════
  // 5. ERP VENDORS
  // ════════════════════════════════════════════════════════
  console.log('👥 Seeding ERP vendors...');

  const vendorDefs: Record<string, object[]> = {
    sap: [
      { external_id: 'SAP-V001', name: 'Acme Corporation',     email: 'ap@acmecorp.com',           wallet_address: '0xACME000000000000000000000000000000000001', chain: 'ethereum' },
      { external_id: 'SAP-V002', name: 'TechSupply Ltd',       email: 'billing@techsupply.io',     wallet_address: '0xTECH000000000000000000000000000000000002', chain: 'ethereum' },
      { external_id: 'SAP-V003', name: 'Global Materials Inc', email: 'ap@globalmaterials.com',    wallet_address: '0xGLOB000000000000000000000000000000000003', chain: 'ethereum' },
      { external_id: 'SAP-V004', name: 'FastShip Logistics',   email: 'finance@fastship.co',       wallet_address: '7nYZKFrJeBsxzVsQKRHFujJtVZmq7FgQBMTPJiN3', chain: 'solana' },
    ],
    oracle: [
      { external_id: 'ORC-V001', name: 'Nexus Digital',        email: 'ar@nexusdigital.com',       wallet_address: '0xNEXU000000000000000000000000000000000001', chain: 'ethereum' },
      { external_id: 'ORC-V002', name: 'Vertex Analytics',     email: 'payments@vertexai.io',      wallet_address: '0xVERT000000000000000000000000000000000002', chain: 'ethereum' },
      { external_id: 'ORC-V003', name: 'DataBridge Systems',   email: 'billing@databridge.tech',   wallet_address: 'BridgeKFrJeBsxzVsQKRHFujJtVZmq7FgQBMTPJN3', chain: 'solana' },
    ],
    xero: [
      { external_id: 'XRO-V001', name: 'Apex Software',        email: 'accounts@apexsoft.com',     wallet_address: '0xAPEX000000000000000000000000000000000001', chain: 'ethereum' },
      { external_id: 'XRO-V002', name: 'Meridian Consulting',  email: 'ar@meridianconsult.com',    wallet_address: '0xMERD000000000000000000000000000000000002', chain: 'ethereum' },
      { external_id: 'XRO-V003', name: 'Clearwater Services',  email: 'billing@clearwatersvcs.com',wallet_address: 'ClearKFrJeBsxzVsQKRHFujJtVZmq7FgQBMTPJN3', chain: 'solana' },
    ],
    netsuite: [
      { external_id: 'NS-V001',  name: 'Stratford Technologies',email: 'ap@stratfordtech.com',     wallet_address: '0xSTRA000000000000000000000000000000000001', chain: 'ethereum' },
      { external_id: 'NS-V002',  name: 'Pacific Rim Trading',  email: 'finance@pacificrim.com',    wallet_address: 'PacifKFrJeBsxzVsQKRHFujJtVZmq7FgQBMTPJN3', chain: 'solana' },
      { external_id: 'NS-V003',  name: 'Atlas Infrastructure', email: 'billing@atlasinfra.io',     wallet_address: '0xATLA000000000000000000000000000000000003', chain: 'ethereum' },
      { external_id: 'NS-V004',  name: 'Horizon Cloud',        email: 'accounts@horizoncloud.co',  wallet_address: '0xHORI000000000000000000000000000000000004', chain: 'ethereum' },
    ],
  };

  const vendorRows: object[] = [];
  for (const cfg of allErp) {
    for (const v of (vendorDefs[cfg.provider] ?? [])) {
      vendorRows.push({ ...(v as object), erp_config_id: cfg.id, synced_at: cfg.last_synced });
    }
  }

  const { data: vendors } = await sb.from('erp_vendors').insert(vendorRows).select();
  console.log(`✓ ${vendors?.length ?? 0} ERP vendors`);

  // ════════════════════════════════════════════════════════
  // 6. INVOICES (historical + a few upcoming unpaid)
  // ════════════════════════════════════════════════════════
  console.log('\n📄 Seeding invoices...');

  const tokens = ['USDC', 'USDT', 'PYUSD'] as const;
  const chains = ['ethereum', 'solana'] as const;
  const invoiceRows: object[] = [];

  // Paid invoices (historical — last 90 days)
  const paidInvoiceConfigs = [
    { vendor: 'Acme Corporation',      erp: 'sap',      amount: 85_000,  token: 'USDC', chain: 'ethereum', daysBack: 85 },
    { vendor: 'TechSupply Ltd',        erp: 'sap',      amount: 42_500,  token: 'USDT', chain: 'ethereum', daysBack: 78 },
    { vendor: 'Global Materials Inc',  erp: 'sap',      amount: 120_000, token: 'USDC', chain: 'ethereum', daysBack: 70 },
    { vendor: 'FastShip Logistics',    erp: 'sap',      amount: 28_000,  token: 'USDC', chain: 'solana',   daysBack: 62 },
    { vendor: 'Nexus Digital',         erp: 'oracle',   amount: 95_500,  token: 'USDC', chain: 'ethereum', daysBack: 55 },
    { vendor: 'Vertex Analytics',      erp: 'oracle',   amount: 67_200,  token: 'USDT', chain: 'ethereum', daysBack: 47 },
    { vendor: 'DataBridge Systems',    erp: 'oracle',   amount: 33_800,  token: 'USDC', chain: 'solana',   daysBack: 40 },
    { vendor: 'Apex Software',         erp: 'xero',     amount: 55_000,  token: 'USDC', chain: 'ethereum', daysBack: 35 },
    { vendor: 'Meridian Consulting',   erp: 'xero',     amount: 78_000,  token: 'PYUSD',chain: 'ethereum', daysBack: 28 },
    { vendor: 'Stratford Technologies',erp: 'netsuite', amount: 112_000, token: 'USDC', chain: 'ethereum', daysBack: 21 },
    { vendor: 'Atlas Infrastructure',  erp: 'netsuite', amount: 44_500,  token: 'USDT', chain: 'ethereum', daysBack: 14 },
    { vendor: 'Horizon Cloud',         erp: 'netsuite', amount: 29_900,  token: 'PYUSD',chain: 'ethereum', daysBack: 7  },
  ];

  let invNum = 1000;
  for (const ic of paidInvoiceConfigs) {
    const cfg = allErp.find(c => c.provider === ic.erp);
    const vendor = vendors?.find(v => v.name === ic.vendor);
    if (!cfg || !vendor) continue;
    const dueD = daysAgo(ic.daysBack - 5);
    const paidD = daysAgo(ic.daysBack - 3);
    invoiceRows.push({
      user_id: userId,
      erp_config_id: cfg.id,
      erp_invoice_id: `${ic.erp.toUpperCase()}-INV-${invNum}`,
      vendor_id: vendor.id,
      invoice_number: `INV-${invNum++}`,
      description: `Services from ${ic.vendor}`,
      amount: ic.amount,
      token: ic.token,
      chain: ic.chain,
      status: 'paid',
      due_date: dateStr(dueD),
      paid_at: ts(paidD),
    });
  }

  // Overdue invoices (past due, still unpaid)
  const overdueConfigs = [
    { vendor: 'Clearwater Services', erp: 'xero',     amount: 38_500,  token: 'USDT', chain: 'solana',   daysBack: 18 },
    { vendor: 'Pacific Rim Trading', erp: 'netsuite', amount: 62_000,  token: 'USDC', chain: 'solana',   daysBack: 12 },
    { vendor: 'TechSupply Ltd',      erp: 'sap',      amount: 19_800,  token: 'USDC', chain: 'ethereum', daysBack: 5  },
  ];
  for (const ic of overdueConfigs) {
    const cfg = allErp.find(c => c.provider === ic.erp);
    const vendor = vendors?.find(v => v.name === ic.vendor);
    if (!cfg || !vendor) continue;
    invoiceRows.push({
      user_id: userId,
      erp_config_id: cfg.id,
      erp_invoice_id: `${ic.erp.toUpperCase()}-INV-${invNum}`,
      vendor_id: vendor.id,
      invoice_number: `INV-${invNum++}`,
      description: `Overdue: Services from ${ic.vendor}`,
      amount: ic.amount,
      token: ic.token,
      chain: ic.chain,
      status: 'overdue',
      due_date: dateStr(daysAgo(ic.daysBack)),
    });
  }

  // Upcoming unpaid invoices (due in the next 30 days)
  const upcomingConfigs = [
    { vendor: 'Acme Corporation',      erp: 'sap',      amount: 95_000,  token: 'USDC', chain: 'ethereum', daysFwd: 8  },
    { vendor: 'Nexus Digital',         erp: 'oracle',   amount: 88_500,  token: 'USDC', chain: 'ethereum', daysFwd: 15 },
    { vendor: 'Apex Software',         erp: 'xero',     amount: 55_000,  token: 'USDC', chain: 'ethereum', daysFwd: 22 },
    { vendor: 'Global Materials Inc',  erp: 'sap',      amount: 130_000, token: 'USDC', chain: 'ethereum', daysFwd: 30 },
    { vendor: 'Stratford Technologies',erp: 'netsuite', amount: 75_000,  token: 'USDT', chain: 'ethereum', daysFwd: 45 },
  ];
  for (const ic of upcomingConfigs) {
    const cfg = allErp.find(c => c.provider === ic.erp);
    const vendor = vendors?.find(v => v.name === ic.vendor);
    if (!cfg || !vendor) continue;
    invoiceRows.push({
      user_id: userId,
      erp_config_id: cfg.id,
      erp_invoice_id: `${ic.erp.toUpperCase()}-INV-${invNum}`,
      vendor_id: vendor.id,
      invoice_number: `INV-${invNum++}`,
      description: `Upcoming: Services from ${ic.vendor}`,
      amount: ic.amount,
      token: ic.token,
      chain: ic.chain,
      status: 'unpaid',
      due_date: dateStr(daysFromNow(ic.daysFwd)),
    });
  }

  const { data: invoices } = await sb.from('invoices').insert(invoiceRows).select();
  console.log(`✓ ${invoices?.length ?? 0} invoices (${paidInvoiceConfigs.length} paid, ${overdueConfigs.length} overdue, ${upcomingConfigs.length} upcoming)`);

  // ════════════════════════════════════════════════════════
  // 7. TRANSACTIONS (historical — last 90 days)
  // ════════════════════════════════════════════════════════
  console.log('\n⛓  Seeding transactions...');

  const txRows: object[] = [];
  // ~2-4 transactions per week over 90 days ≈ 100+ transactions
  const txDays = Array.from({ length: 90 }, (_, i) => 90 - i); // 90 days ago → today
  for (const daysBack of txDays) {
    // Randomly include 0-1 transactions per day (weighted)
    const txCount = Math.random() < 0.35 ? 1 : Math.random() < 0.15 ? 2 : 0;
    for (let t = 0; t < txCount; t++) {
      const isOutbound = Math.random() > 0.3; // 70% outbound (payments to vendors)
      const wallet = pick([ethMain, ethOps, ethRes, solMain, solPay]);
      const isEth = wallet.chain === 'ethereum';
      const token = pick(isEth ? ['USDC', 'USDT', 'PYUSD'] : ['USDC', 'USDT']) as 'USDC' | 'USDT' | 'PYUSD';
      const amount = isOutbound ? rand(5_000, 150_000) : rand(50_000, 500_000);
      const dayTs = daysAgo(daysBack);
      dayTs.setHours(randInt(8, 18), randInt(0, 59));

      txRows.push({
        user_id: userId,
        wallet_id: wallet.id,
        chain: wallet.chain,
        tx_hash: isEth ? ethHash() : solHash(),
        block_number: isEth ? randInt(19_000_000, 21_500_000) : randInt(250_000_000, 300_000_000),
        from_address: isOutbound ? wallet.address : (isEth ? '0x' + 'a'.repeat(40) : 'ExternalSolanaAddr11111111111111111111111111'),
        to_address:   isOutbound ? (isEth ? '0x' + 'b'.repeat(40) : 'RecipSolanaAddr111111111111111111111111111') : wallet.address,
        token,
        amount: fmt2(amount),
        fee: isEth ? fmt2(rand(0.5, 8)) : fmt2(rand(0.001, 0.01)),
        status: 'confirmed',
        direction: isOutbound ? 'outbound' : 'inbound',
        timestamp: ts(dayTs),
      });
    }
  }

  const { data: transactions } = await sb.from('transactions').insert(txRows).select();
  console.log(`✓ ${transactions?.length ?? 0} transactions`);

  // ════════════════════════════════════════════════════════
  // 8. PAYMENTS (historical completed + a few scheduled)
  // ════════════════════════════════════════════════════════
  console.log('\n💸 Seeding payments...');

  const paymentRows: object[] = [];
  const paidInvoiceRows = invoices?.filter(i => i.status === 'paid') ?? [];

  // One payment per paid invoice
  for (const inv of paidInvoiceRows) {
    const wallet = inv.chain === 'solana' ? pick([solMain, solPay]) : pick([ethMain, ethOps]);
    const execAt = inv.paid_at ?? ts(daysAgo(5));
    paymentRows.push({
      user_id: userId,
      invoice_id: inv.id,
      from_wallet_id: wallet.id,
      to_address: inv.chain === 'ethereum'
        ? '0x' + Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40)
        : 'VendorSolanaPayAddr1111111111111111111111111',
      chain: inv.chain,
      token: inv.token,
      amount: inv.amount,
      status: 'completed',
      executed_at: execAt,
      tx_hash: inv.chain === 'ethereum' ? ethHash() : solHash(),
      memo: `Payment for ${inv.invoice_number}`,
    });
  }

  // A few extra ad-hoc completed payments (not tied to invoices)
  for (let i = 0; i < 15; i++) {
    const wallet = pick([ethMain, ethOps, ethRes, solMain, solPay]);
    const isEth = wallet.chain === 'ethereum';
    const execAt = daysAgo(randInt(1, 89));
    paymentRows.push({
      user_id: userId,
      from_wallet_id: wallet.id,
      to_address: isEth ? '0x' + Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40) : 'AdHocSolanaAddr11111111111111111111111111111',
      chain: wallet.chain,
      token: pick(isEth ? ['USDC', 'USDT', 'PYUSD'] : ['USDC', 'USDT']) as string,
      amount: fmt2(rand(3_000, 80_000)),
      status: 'completed',
      executed_at: ts(execAt),
      tx_hash: isEth ? ethHash() : solHash(),
      memo: `Ad-hoc payment ${i + 1}`,
    });
  }

  // Scheduled future payments (pending)
  const scheduledDays = [5, 12, 20, 35, 60];
  for (const d of scheduledDays) {
    paymentRows.push({
      user_id: userId,
      from_wallet_id: ethMain.id,
      to_address: '0x' + Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40),
      chain: 'ethereum',
      token: 'USDC',
      amount: fmt2(rand(20_000, 100_000)),
      status: 'pending',
      scheduled_for: ts(daysFromNow(d)),
      memo: `Scheduled payment due in ${d} days`,
    });
  }

  const { data: payments } = await sb.from('payments').insert(paymentRows).select();
  console.log(`✓ ${payments?.length ?? 0} payments (${paidInvoiceRows.length} invoice-linked, 15 ad-hoc, ${scheduledDays.length} scheduled)`);

  // ════════════════════════════════════════════════════════
  // 9. BALANCE SNAPSHOTS (daily, 90 days historical)
  // ════════════════════════════════════════════════════════
  console.log('\n📊 Seeding balance snapshots (90 days × wallets × tokens)...');

  const snapshotRows: object[] = [];
  for (const [walletId, tokens] of Object.entries(currentBalances)) {
    for (const [token, currentBal] of Object.entries(tokens)) {
      const history = balanceHistory(currentBal, 90);
      for (let day = 0; day <= 90; day++) {
        const snappedAt = daysAgo(90 - day);
        snappedAt.setHours(0, 5, 0, 0);
        snapshotRows.push({
          wallet_id: walletId,
          token,
          balance: fmt2(history[day]),
          usd_value: fmt2(history[day]),
          snapped_at: ts(snappedAt),
        });
      }
    }
  }

  // Insert in batches of 500
  for (let i = 0; i < snapshotRows.length; i += 500) {
    await sb.from('balance_snapshots').insert(snapshotRows.slice(i, i + 500));
  }
  console.log(`✓ ${snapshotRows.length} balance snapshots`);

  // ════════════════════════════════════════════════════════
  // 10. FIAT TRANSACTIONS (ramp history — last 90 days)
  // ════════════════════════════════════════════════════════
  console.log('\n🏧 Seeding fiat transactions (ramp history)...');

  const fiatRows: object[] = [];
  const rampSchedule = [
    { daysBack: 88, dir: 'onramp',  crypto: 500_000, fiat: 499_500,  bank: svbBank },
    { daysBack: 75, dir: 'offramp', crypto: 200_000, fiat: 199_600,  bank: chaseBank },
    { daysBack: 60, dir: 'onramp',  crypto: 350_000, fiat: 349_650,  bank: svbBank },
    { daysBack: 48, dir: 'offramp', crypto: 150_000, fiat: 149_700,  bank: chaseBank },
    { daysBack: 35, dir: 'onramp',  crypto: 400_000, fiat: 399_600,  bank: svbBank },
    { daysBack: 22, dir: 'offramp', crypto: 250_000, fiat: 249_500,  bank: mercuryBank },
    { daysBack: 14, dir: 'onramp',  crypto: 300_000, fiat: 299_700,  bank: svbBank },
    { daysBack: 7,  dir: 'offramp', crypto: 100_000, fiat: 99_850,   bank: chaseBank },
    { daysBack: 2,  dir: 'onramp',  crypto: 450_000, fiat: 449_550,  bank: svbBank },
  ];

  for (const r of rampSchedule) {
    const settledAt = daysAgo(r.daysBack - 1);
    fiatRows.push({
      user_id: userId,
      bank_account_id: r.bank.id,
      direction: r.dir,
      crypto_amount: r.crypto,
      crypto_token: 'USDC',
      fiat_amount: r.fiat,
      fiat_currency: 'USD',
      exchange_rate: fmt2(r.fiat / r.crypto),
      fee_amount: fmt2(Math.abs(r.crypto - r.fiat)),
      status: 'completed',
      provider: 'bridge',
      provider_transaction_id: `bridge_tx_${Date.now()}_${r.daysBack}`,
      settled_at: ts(settledAt),
      created_at: ts(daysAgo(r.daysBack)),
    });
  }

  await sb.from('fiat_transactions').insert(fiatRows);
  console.log(`✓ ${fiatRows.length} fiat transactions`);

  // ════════════════════════════════════════════════════════
  // 11. TREASURY RULE
  // ════════════════════════════════════════════════════════
  console.log('\n⚙️  Seeding treasury rule...');

  const { data: rule } = await sb.from('treasury_rules').insert({
    user_id: userId,
    label: 'Default Treasury Policy',
    is_active: true,
    safety_buffer_multiplier: 1.5,
    obligation_lookahead_days: 30,
    target_stablecoin: 'USDC',
    target_chain: 'ethereum',
    approval_threshold_usd: 100_000,
  }).select().single();

  console.log('✓ Treasury rule created');

  // ════════════════════════════════════════════════════════
  // 12. MANUAL OBLIGATIONS (prospective — next 90 days)
  // ════════════════════════════════════════════════════════
  console.log('\n📅 Seeding manual obligations (90-day forward view)...');

  const obligationRows: object[] = [];

  // Recurring monthly obligations
  const monthlyObligations = [
    { label: 'AWS Cloud Services',       amount: 15_000,  dayOfMonth: 1  },
    { label: 'Office Lease — HQ',        amount: 25_000,  dayOfMonth: 15 },
    { label: 'Colocation & Data Center', amount: 8_500,   dayOfMonth: 5  },
    { label: 'Business Insurance',       amount: 12_000,  dayOfMonth: 20 },
    { label: 'SaaS Subscriptions',       amount: 7_200,   dayOfMonth: 28 },
  ];

  for (const ob of monthlyObligations) {
    // Find the next 3 occurrences within 90 days
    for (let monthOffset = 0; monthOffset < 3; monthOffset++) {
      const d = new Date();
      d.setMonth(d.getMonth() + monthOffset);
      d.setDate(ob.dayOfMonth);
      if (d > new Date() && d <= daysFromNow(90)) {
        obligationRows.push({
          user_id: userId,
          label: ob.label,
          description: `Monthly recurring — due on the ${ob.dayOfMonth}${ob.dayOfMonth === 1 ? 'st' : ob.dayOfMonth === 15 ? 'th' : 'th'}`,
          amount_usd: ob.amount,
          due_date: dateStr(d),
          is_recurring: true,
          recurrence_days: 30,
          is_active: true,
        });
      }
    }
  }

  // Bi-weekly payroll
  for (let week = 0; week < 6; week++) {
    const d = daysFromNow(7 + week * 14);
    if (d <= daysFromNow(90)) {
      obligationRows.push({
        user_id: userId,
        label: 'Payroll Processing',
        description: 'Bi-weekly payroll via USDC',
        amount_usd: 180_000,
        due_date: dateStr(d),
        is_recurring: true,
        recurrence_days: 14,
        is_active: true,
      });
    }
  }

  // One-time future obligations
  const oneTimeFuture = [
    { label: 'Q1 Software License Renewal', amount: 35_000,  days: 22 },
    { label: 'Marketing Campaign — Q2',      amount: 45_000,  days: 38 },
    { label: 'Infrastructure Upgrade',       amount: 120_000, days: 55 },
    { label: 'Consulting Services Contract', amount: 50_000,  days: 67 },
    { label: 'Annual Audit Fee',             amount: 28_000,  days: 82 },
  ];

  for (const ob of oneTimeFuture) {
    obligationRows.push({
      user_id: userId,
      label: ob.label,
      description: `One-time payment due in ${ob.days} days`,
      amount_usd: ob.amount,
      due_date: dateStr(daysFromNow(ob.days)),
      is_recurring: false,
      is_active: true,
    });
  }

  await sb.from('manual_obligations').insert(obligationRows);
  console.log(`✓ ${obligationRows.length} obligations (monthly recurring + bi-weekly payroll + one-time)`);

  // ════════════════════════════════════════════════════════
  // 13. AI RECOMMENDATIONS (mix of historical + pending)
  // ════════════════════════════════════════════════════════
  console.log('\n🤖 Seeding AI recommendations...');

  const ruleId = rule?.id ?? null;
  const totalCrypto = 850_000 + 150_000 + 50_000 + 125_000 + 25_000 + 500_000 + 100_000 + 275_000 + 50_000 + 25_000; // 2,150,000
  const totalBank   = 450_000 + 1_200_000 + 85_000; // 1,735,000

  const aiRows = [
    // Executed onramp 8 weeks ago
    {
      user_id: userId,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: 820_000,
      total_crypto_balance_usd: 1_400_000,
      obligations_in_window_usd: 620_000,
      safety_buffer_target_usd: 930_000,
      obligation_lookahead_days: 30,
      action: 'onramp',
      recommended_amount_usd: 500_000,
      bank_account_id: svbBank.id,
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Projected crypto balance falls below safety buffer within 30 days. Recommend onramp of $500K USDC from SVB Operating Account to cover upcoming payroll and vendor obligations.',
      ai_model: 'claude-sonnet-4-6',
      status: 'executed',
      requires_approval: false,
      executed_at: ts(daysAgo(56)),
      created_at: ts(daysAgo(57)),
      updated_at: ts(daysAgo(56)),
      expires_at: ts(daysAgo(33)),
    },
    // Approved + executed offramp 3 weeks ago
    {
      user_id: userId,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: 980_000,
      total_crypto_balance_usd: 2_350_000,
      obligations_in_window_usd: 480_000,
      safety_buffer_target_usd: 720_000,
      obligation_lookahead_days: 30,
      action: 'offramp',
      recommended_amount_usd: 200_000,
      bank_account_id: chaseBank.id,
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Crypto holdings significantly exceed safety buffer target. Offramp $200K USDC to Chase Business Checking to optimize yield on idle stablecoin reserves.',
      ai_model: 'claude-sonnet-4-6',
      status: 'executed',
      requires_approval: true,
      executed_at: ts(daysAgo(19)),
      created_at: ts(daysAgo(21)),
      updated_at: ts(daysAgo(19)),
      expires_at: ts(daysAgo(20)),
    },
    // No-action recommendation last week
    {
      user_id: userId,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: totalBank,
      total_crypto_balance_usd: totalCrypto,
      obligations_in_window_usd: 520_000,
      safety_buffer_target_usd: 780_000,
      obligation_lookahead_days: 30,
      action: 'no_action',
      recommended_amount_usd: null,
      bank_account_id: null,
      stablecoin_token: null,
      stablecoin_chain: null,
      ai_reasoning: 'Treasury position is healthy. Total crypto balance of $2.15M exceeds the safety buffer target of $780K with comfortable margin. No action required at this time.',
      ai_model: 'claude-sonnet-4-6',
      status: 'auto_executed',
      requires_approval: false,
      executed_at: ts(daysAgo(7)),
      created_at: ts(daysAgo(7)),
      updated_at: ts(daysAgo(7)),
      expires_at: ts(daysAgo(6)),
    },
    // Pending onramp recommendation (requires approval)
    {
      user_id: userId,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: totalBank,
      total_crypto_balance_usd: totalCrypto,
      obligations_in_window_usd: 920_000,
      safety_buffer_target_usd: 1_380_000,
      obligation_lookahead_days: 30,
      action: 'onramp',
      recommended_amount_usd: 350_000,
      bank_account_id: svbBank.id,
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Upcoming obligations over the next 30 days total $920K, including $180K bi-weekly payroll, $95K Acme Corp invoice, $88.5K Nexus Digital invoice, and infrastructure upgrade of $120K. Current crypto balance provides only 2.3× coverage vs. required 1.5× safety buffer. Recommend onramp of $350K USDC from SVB Operating Account.',
      ai_model: 'claude-sonnet-4-6',
      status: 'pending_approval',
      requires_approval: true,
      created_at: ts(daysAgo(1)),
      updated_at: ts(daysAgo(1)),
      expires_at: ts(daysFromNow(23)),
    },
    // Rejected recommendation (declined by user last month)
    {
      user_id: userId,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: 1_500_000,
      total_crypto_balance_usd: 1_900_000,
      obligations_in_window_usd: 380_000,
      safety_buffer_target_usd: 570_000,
      obligation_lookahead_days: 30,
      action: 'offramp',
      recommended_amount_usd: 300_000,
      bank_account_id: chaseBank.id,
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Excess stablecoin reserves above safety buffer. Recommend offramp of $300K USDC to maximize yield in money market accounts.',
      ai_model: 'claude-sonnet-4-6',
      status: 'rejected',
      requires_approval: true,
      rejection_reason: 'Holding reserves for anticipated Q2 expansion spend.',
      rejected_at: ts(daysAgo(40)),
      created_at: ts(daysAgo(41)),
      updated_at: ts(daysAgo(40)),
      expires_at: ts(daysAgo(40)),
    },
  ];

  await sb.from('ai_recommendations').insert(aiRows);
  console.log(`✓ ${aiRows.length} AI recommendations`);

  // ════════════════════════════════════════════════════════
  // 14. TREASURY FORECAST (90-day forward projection)
  // ════════════════════════════════════════════════════════
  console.log('\n📈 Seeding treasury forecast...');

  const forecastData = [];
  let runningBalance = totalCrypto; // start at current crypto total

  // Build obligation schedule for next 90 days from our seed obligations
  const futureObligationsByDate: Record<string, { labels: string[]; total: number }> = {};
  for (const ob of obligationRows) {
    const d = (ob as any).due_date as string;
    if (!futureObligationsByDate[d]) futureObligationsByDate[d] = { labels: [], total: 0 };
    futureObligationsByDate[d].labels.push((ob as any).label);
    futureObligationsByDate[d].total += (ob as any).amount_usd;
  }

  // Scheduled ramps (from fiat_transactions we'll add in the future)
  const scheduledRampsByDate: Record<string, number> = {
    [dateStr(daysFromNow(10))]: 350_000, // pending onramp recommendation
  };

  for (let day = 1; day <= 90; day++) {
    const d = daysFromNow(day);
    const dStr = dateStr(d);
    const obligationsToday = futureObligationsByDate[dStr];
    const obligationsDue = obligationsToday?.total ?? 0;
    const obligationLabels = obligationsToday?.labels ?? [];
    const scheduledRamps = scheduledRampsByDate[dStr] ?? 0;

    runningBalance -= obligationsDue;
    runningBalance += scheduledRamps;
    runningBalance += rand(-5_000, 15_000); // small daily inflows

    const safetyBuffer = 780_000; // 1.5× average monthly obligations
    const isBelow = runningBalance < safetyBuffer;

    forecastData.push({
      date: dStr,
      projectedBalanceUsd: fmt2(Math.max(0, runningBalance)),
      obligationsDueUsd: fmt2(obligationsDue),
      safetyBufferUsd: fmt2(safetyBuffer),
      isBelow,
      scheduledRampsUsd: fmt2(scheduledRamps),
      obligationLabels,
    });
  }

  const { error: fcErr } = await sb.from('treasury_forecasts').upsert({
    user_id: userId,
    lookahead_days: 90,
    forecast_data: forecastData,
    ai_summary: [
      `Treasury forecast over the next 90 days shows a projected balance starting at $${(totalCrypto / 1_000_000).toFixed(2)}M.`,
      `Key obligations include bi-weekly payroll ($180K), upcoming vendor invoices ($443K), and one-time infrastructure spend ($120K).`,
      `A pending onramp of $350K is scheduled to maintain the safety buffer. The position remains healthy throughout the forecast window,`,
      `with balance projected to stay above the $780K safety threshold except for brief dips around major payroll dates.`,
      `Recommend approving the pending onramp recommendation to ensure comfortable coverage.`,
    ].join(' '),
    generated_at: ts(new Date()),
  }, { onConflict: 'user_id,lookahead_days' });

  if (fcErr) console.error('  Forecast error:', fcErr.message);
  else console.log(`✓ Treasury forecast (${forecastData.length} data points)`);

  // ════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log('✅  Seed complete!\n');
  console.log('  Wallets          :', wallets.length, '(3 Ethereum + 2 Solana)');
  console.log('  Bank accounts    :', banks.length, '(Chase, SVB, Mercury)');
  console.log('  ERP configs      :', allErp.length);
  console.log('  ERP vendors      :', vendors?.length ?? 0);
  console.log('  Invoices         :', invoices?.length ?? 0);
  console.log('  Transactions     :', transactions?.length ?? 0, '(90-day history)');
  console.log('  Payments         :', payments?.length ?? 0);
  console.log('  Balance snapshots:', snapshotRows.length, '(daily × all wallets)');
  console.log('  Fiat ramps       :', fiatRows.length, '(onramp/offramp history)');
  console.log('  Obligations      :', obligationRows.length, '(next 90 days)');
  console.log('  AI recommendations:', aiRows.length);
  console.log('  Forecast         : 90-day projection');
  console.log('');
  console.log('  Total bank balance  : $1,735,000');
  console.log('  Total crypto balance: $2,150,000');
  console.log('  Total AUM           : $3,885,000');
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message ?? err);
  process.exit(1);
});
