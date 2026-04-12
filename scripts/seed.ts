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

async function resolveUser(): Promise<{ userId: string; enterpriseId: string | null }> {
  let profile: { id: string; email: string; enterprise_id: string | null } | null = null;

  if (userIdArg) {
    const { data } = await sb.from('user_profiles').select('id, email, enterprise_id').eq('id', userIdArg).single();
    profile = data;
  } else if (emailArg) {
    const { data } = await sb.from('user_profiles').select('id, email, enterprise_id').eq('email', emailArg).single();
    profile = data;
  } else {
    const { data } = await sb.from('user_profiles').select('id, email, enterprise_id').limit(1).single();
    profile = data;
  }

  if (!profile) throw new Error('User not found.\n  Create an account via the app first, then run: npm run seed');
  console.log(`✓ Seeding for ${profile.email} (${profile.id})${profile.enterprise_id ? ` [enterprise: ${profile.enterprise_id}]` : ''}`);
  return { userId: profile.id, enterpriseId: profile.enterprise_id };
}

// ─── Clean ──────────────────────────────────────────────────────────────────

async function cleanUserData(userId: string) {
  console.log('\n🧹 Wiping previous seed data...');

  // Must delete in FK-safe order.
  // forecast_snapshots has a NOT NULL FK to treasury_state_snapshots so
  // the child goes first. obligations (formerly manual_obligations)
  // replaces the legacy table name per migration 0041 (renumbered from
  // 0036 post-merge). treasury_forecasts was dropped in migration 0044
  // (renumbered from 0039). treasury_insights is the insights engine
  // feed from migration 0037 (feature/proactive-ai).
  for (const t of ['simulation_runs', 'forecast_snapshots', 'treasury_state_snapshots',
    'ai_recommendations', 'obligations', 'treasury_rules', 'yield_transactions', 'yield_positions',
    'fiat_transactions', 'gl_postings',
    'kyt_alerts', 'kyt_transfers', 'sanctions_screenings', 'travel_rule_transfers',
    'notifications', 'treasury_insights']) {
    await sb.from(t).delete().eq('user_id', userId);
  }

  // Policy engine: child triggers check parent version exists + is draft,
  // so children must be deleted before versions, and versions before policies.
  // Look up enterprise from user to find the right test enterprise.
  const { data: userEnt } = await sb.from('user_profiles').select('enterprise_id').eq('id', userId).single();
  if (userEnt?.enterprise_id) {
    const { data: ent } = await sb.from('enterprises').select('test_enterprise_id').eq('id', userEnt.enterprise_id).single();
    const policyEntId = ent?.test_enterprise_id ?? userEnt.enterprise_id;
    const { data: draftVersions } = await sb
      .from('policy_versions').select('id')
      .eq('enterprise_id', policyEntId).eq('status', 'draft');
    if (draftVersions?.length) {
      const vIds = draftVersions.map(v => v.id);
      // Order matters: rules FK→chains, so rules first; policies FK→versions via active_version_id
      await sb.from('policy_rules').delete().in('version_id', vIds);
      await sb.from('policy_hard_limits').delete().in('version_id', vIds);
      await sb.from('policy_approval_chains').delete().in('version_id', vIds);
      // Null out active_version_id before deleting versions (FK constraint)
      await sb.from('policy_policies').update({ active_version_id: null }).eq('enterprise_id', policyEntId);
      await sb.from('policy_versions').delete().in('id', vIds);
    }
    await sb.from('policy_policies').delete().eq('enterprise_id', policyEntId);
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

  const { userId, enterpriseId: realEnterpriseId } = await resolveUser();

  // ALWAYS seed into the test enterprise (Lite test mode data only).
  // Seed data must NEVER go to paid test or paid live enterprises.
  let enterpriseId: string | null = null;
  if (realEnterpriseId) {
    const { data: ent } = await sb
      .from('enterprises')
      .select('test_enterprise_id')
      .eq('id', realEnterpriseId)
      .single();
    if (!ent?.test_enterprise_id) {
      throw new Error(
        `No test enterprise found for enterprise ${realEnterpriseId}.\n` +
        `  Seed data only goes to the Lite test enterprise.\n` +
        `  Set test_enterprise_id on the enterprise first.`
      );
    }
    enterpriseId = ent.test_enterprise_id;

    // Verify the target is actually a Lite/test enterprise, not a paid one
    const { data: testEnt } = await sb
      .from('subscriptions')
      .select('tier')
      .eq('enterprise_id', enterpriseId)
      .single();
    if (testEnt && testEnt.tier !== 'lite') {
      throw new Error(
        `Test enterprise ${enterpriseId} is on the '${testEnt.tier}' tier, not 'lite'.\n` +
        `  Seed data can ONLY go to Lite test enterprises.\n` +
        `  This is a safety check to prevent dummy data in paid environments.`
      );
    }

    console.log(`  → Seeding into test enterprise: ${enterpriseId} (lite tier verified)`);
  }

  // Shorthand for inserting enterprise_id on every row
  const eid = enterpriseId ? { enterprise_id: enterpriseId } : {};

  await cleanUserData(userId);

  // ════════════════════════════════════════════════════════
  // 1. WALLETS
  // ════════════════════════════════════════════════════════
  console.log('\n💼 Seeding wallets...');

  const { data: wallets, error: wErr } = await sb.from('wallets').insert([
    {
      user_id: userId,
      ...eid,
      chain: 'ethereum',
      address: '0x742d35Cc6634C0532925a3b844Bc454d0a2c3e1f',
      label: 'Treasury Main',
      is_primary: true,
      verified_at: ts(daysAgo(60)),
    },
    {
      user_id: userId,
      ...eid,
      chain: 'ethereum',
      address: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0e',
      label: 'Operations',
      is_primary: false,
      verified_at: ts(daysAgo(45)),
    },
    {
      user_id: userId,
      ...eid,
      chain: 'ethereum',
      address: '0x2e988a386a799f506693793c6a5af6b54dfaabfb',
      label: 'Reserve',
      is_primary: false,
      verified_at: ts(daysAgo(30)),
    },
    {
      user_id: userId,
      ...eid,
      chain: 'solana',
      address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
      label: 'Solana Treasury',
      is_primary: true,
      verified_at: ts(daysAgo(50)),
    },
    {
      user_id: userId,
      ...eid,
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
    [ethMain.id]: { USDC: 850_000, USDT: 150_000 },
    [ethOps.id]:  { USDC: 125_000, USDT: 25_000 },
    [ethRes.id]:  { USDC: 500_000 },
    [solMain.id]: { USDC: 275_000 },
    [solPay.id]:  { USDT: 50_000 },
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
        ...eid,
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
      ...eid,
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
      banking_provider: 'stripe_fc',
      stripe_fc_account_id: 'fca_mock_chase_001',
    },
    {
      user_id: userId,
      ...eid,
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
      banking_provider: 'stripe_fc',
      stripe_fc_account_id: 'fca_mock_svb_001',
    },
    {
      user_id: userId,
      ...eid,
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
      banking_provider: 'stripe_fc',
      stripe_fc_account_id: 'fca_mock_mercury_001',
    },
    {
      user_id: userId,
      ...eid,
      institution_name: 'Barclays',
      account_name: 'EUR Treasury',
      account_type: 'checking',
      last4: '5531',
      currency: 'EUR',
      current_balance: 320_000,
      balance_currency: 'EUR',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(20)),
      banking_provider: 'stripe_fc',
      stripe_fc_account_id: 'fca_mock_barclays_001',
    },
    {
      user_id: userId,
      ...eid,
      institution_name: 'HSBC',
      account_name: 'GBP Operations',
      account_type: 'checking',
      last4: '8812',
      currency: 'GBP',
      current_balance: 175_000,
      balance_currency: 'GBP',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(10)),
      banking_provider: 'manual',
    },
    {
      user_id: userId,
      ...eid,
      institution_name: 'Itaú Unibanco',
      account_name: 'Conta Corrente',
      account_type: 'checking',
      last4: '7823',
      currency: 'BRL',
      current_balance: 1_415_400,
      balance_currency: 'BRL',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(12)),
      nickname: 'Itaú BRL Primary',
      banking_provider: 'belvo',
    },
    {
      user_id: userId,
      ...eid,
      institution_name: 'Nubank',
      account_name: 'Conta PJ',
      account_type: 'checking',
      last4: '3491',
      currency: 'BRL',
      current_balance: 479_775,
      balance_currency: 'BRL',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(8)),
      nickname: 'Nubank BRL Operations',
      banking_provider: 'belvo',
    },
    {
      user_id: userId,
      ...eid,
      institution_name: 'BBVA México',
      account_name: 'Cuenta Empresarial',
      account_type: 'checking',
      last4: '6102',
      currency: 'MXN',
      current_balance: 25_707_500,
      balance_currency: 'MXN',
      balance_as_of: ts(new Date()),
      is_active: true,
      verified_at: ts(daysAgo(5)),
      nickname: 'BBVA MXN Treasury',
      banking_provider: 'belvo',
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
      ...eid,
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
      ...eid,
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
      ...eid,
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
      ...eid,
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
      vendorRows.push({ ...(v as object), ...eid, erp_config_id: cfg.id, synced_at: cfg.last_synced });
    }
  }

  const { data: vendors } = await sb.from('erp_vendors').insert(vendorRows).select();
  console.log(`✓ ${vendors?.length ?? 0} ERP vendors`);

  // ════════════════════════════════════════════════════════
  // 6. INVOICES (historical + a few upcoming unpaid)
  // ════════════════════════════════════════════════════════
  console.log('\n📄 Seeding invoices...');

  const tokens = ['USDC', 'USDT'] as const;
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
    { vendor: 'Meridian Consulting',   erp: 'xero',     amount: 78_000,  token: 'USDC', chain: 'ethereum', daysBack: 28 },
    { vendor: 'Stratford Technologies',erp: 'netsuite', amount: 112_000, token: 'USDC', chain: 'ethereum', daysBack: 21 },
    { vendor: 'Atlas Infrastructure',  erp: 'netsuite', amount: 44_500,  token: 'USDT', chain: 'ethereum', daysBack: 14 },
    { vendor: 'Horizon Cloud',         erp: 'netsuite', amount: 29_900,  token: 'USDT', chain: 'ethereum', daysBack: 7  },
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
      ...eid,
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
      ...eid,
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
      ...eid,
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
      const token = pick(isEth ? ['USDC', 'USDT'] : ['USDC', 'USDT']) as 'USDC' | 'USDT';
      const amount = isOutbound ? rand(5_000, 150_000) : rand(50_000, 500_000);
      const dayTs = daysAgo(daysBack);
      dayTs.setHours(randInt(8, 18), randInt(0, 59));

      txRows.push({
        user_id: userId,
        ...eid,
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
      ...eid,
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
      ...eid,
      from_wallet_id: wallet.id,
      to_address: isEth ? '0x' + Math.random().toString(16).slice(2).padEnd(40, '0').slice(0, 40) : 'AdHocSolanaAddr11111111111111111111111111111',
      chain: wallet.chain,
      token: pick(isEth ? ['USDC', 'USDT'] : ['USDC', 'USDT']) as string,
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
      ...eid,
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
  // 8b. SWAPS (historical, last 90 days)
  // ════════════════════════════════════════════════════════
  console.log('\n🔄 Seeding swaps...');

  const swapPairs: [string, string][] = [
    ['USDC', 'USDT'], ['USDT', 'USDC'],
  ];
  const swapStatuses: string[] = ['completed', 'completed', 'completed', 'completed', 'pending', 'failed'];
  const allWallets = [ethMain, ethOps, ethRes, solMain, solPay];
  const swapRows: object[] = [];

  for (let i = 0; i < 25; i++) {
    const wallet = pick(allWallets);
    const [fromToken, toToken] = pick(swapPairs);
    const fromAmount = fmt2(rand(500, 50_000));
    const rate = fmt2(rand(0.997, 1.003));
    const toAmount = fmt2(fromAmount * rate);
    const status = pick(swapStatuses);
    const createdAt = daysAgo(randInt(1, 85));
    const executedAt = status === 'completed' ? new Date(createdAt.getTime() + randInt(5, 120) * 1000) : null;

    swapRows.push({
      user_id: userId,
      ...eid,
      wallet_id: wallet.id,
      chain: wallet.chain,
      from_token: fromToken,
      to_token: toToken,
      from_amount: fromAmount,
      to_amount: status === 'completed' ? toAmount : null,
      rate: status === 'completed' ? rate : null,
      slippage_bps: pick([25, 50, 50, 100]),
      tx_hash: wallet.chain === 'ethereum' ? ethHash() : solHash(),
      status,
      executed_at: executedAt ? ts(executedAt) : null,
      created_at: ts(createdAt),
    });
  }

  await sb.from('swaps').insert(swapRows);
  console.log(`✓ ${swapRows.length} swaps`);

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
          ...eid,
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
      ...eid,
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
  // 10b. YIELD POSITIONS (DeFi + Tokenized MMF)
  // ════════════════════════════════════════════════════════
  console.log('\n📈 Seeding yield positions (DeFi + tokenized MMFs)...');

  const ethWallets = wallets.filter(w => w.chain === 'ethereum');
  const solWallets = wallets.filter(w => w.chain === 'solana');

  const yieldDefs = [
    // DeFi positions
    { protocol: 'aave_v3',          chain: 'ethereum', token: 'USDC', yieldToken: 'aUSDC',            deposited: 250_000, apy: 4.8,  daysActive: randInt(60, 120), wList: ethWallets },
    { protocol: 'morpho_reservoir', chain: 'ethereum', token: 'USDC', yieldToken: 'bbqUSDCreservoir', deposited: 150_000, apy: 7.0,  daysActive: randInt(30, 90),  wList: ethWallets },
    { protocol: 'kamino',           chain: 'solana',   token: 'USDC', yieldToken: 'kUSDC',            deposited: 100_000, apy: 6.1,  daysActive: randInt(30, 100), wList: solWallets },
    { protocol: 'ondo_usdy',        chain: 'ethereum', token: 'USDC', yieldToken: 'USDY',             deposited: 500_000, apy: 4.5,  daysActive: randInt(40, 110), wList: ethWallets },
    // Tokenized MMF positions
    { protocol: 'spiko_usd',        chain: 'ethereum', token: 'USDC', yieldToken: 'USTBL',            deposited: 250_000, apy: 4.05, daysActive: 45, wList: ethWallets },
    { protocol: 'usyc',             chain: 'ethereum', token: 'USDC', yieldToken: 'USYC',             deposited: 400_000, apy: 3.18, daysActive: 28, wList: ethWallets },
    { protocol: 'ousg',             chain: 'ethereum', token: 'USDC', yieldToken: 'OUSG',             deposited: 750_000, apy: 3.37, daysActive: 14, wList: ethWallets },
  ];

  let yieldPosCount = 0;
  let yieldTxCount = 0;

  for (const yp of yieldDefs) {
    if (!yp.wList.length) continue;
    const wallet = pick(yp.wList);
    const accrued = fmt2(yp.deposited * (yp.apy / 100) * (yp.daysActive / 365));
    const currentValue = fmt2(yp.deposited + accrued);
    const isEth = yp.chain === 'ethereum';

    const { data: pos } = await sb.from('yield_positions').insert({
      user_id: userId, ...eid, wallet_id: wallet.id,
      protocol: yp.protocol, chain: yp.chain, underlying_token: yp.token,
      yield_token: yp.yieldToken, deposited_amount: yp.deposited.toFixed(2),
      current_value_usd: currentValue, accrued_yield_usd: accrued,
      apy_snapshot: yp.apy, last_refreshed_at: ts(new Date()),
      is_active: true, metadata: { mock: true }, created_at: ts(daysAgo(yp.daysActive)),
    }).select('id').single();

    if (!pos) continue;
    yieldPosCount++;

    // Deposit transaction
    await sb.from('yield_transactions').insert({
      user_id: userId, ...eid, position_id: pos.id,
      protocol: yp.protocol, chain: yp.chain, tx_type: 'deposit',
      underlying_token: yp.token, amount: yp.deposited.toFixed(2),
      amount_usd: yp.deposited.toFixed(2), tx_hash: isEth ? ethHash() : solHash(),
      status: 'completed', executed_at: ts(daysAgo(yp.daysActive)), created_at: ts(daysAgo(yp.daysActive)),
    });
    yieldTxCount++;

    // DeFi positions get a random partial withdrawal (MMFs don't)
    const isMMF = ['spiko_usd', 'usyc', 'ousg'].includes(yp.protocol);
    if (!isMMF && Math.random() > 0.5) {
      const withdrawAmt = fmt2(rand(10_000, yp.deposited * 0.3));
      const withdrawDay = randInt(5, yp.daysActive - 5);
      await sb.from('yield_transactions').insert({
        user_id: userId, ...eid, position_id: pos.id,
        protocol: yp.protocol, chain: yp.chain, tx_type: 'withdraw',
        underlying_token: yp.token, amount: withdrawAmt, amount_usd: withdrawAmt,
        tx_hash: isEth ? ethHash() : solHash(), status: 'completed',
        executed_at: ts(daysAgo(withdrawDay)), created_at: ts(daysAgo(withdrawDay)),
      });
      yieldTxCount++;
    }
  }

  console.log(`✓ ${yieldPosCount} yield positions (4 DeFi + 3 tokenized MMFs)`);
  console.log(`✓ ${yieldTxCount} yield transactions`);

  // ════════════════════════════════════════════════════════
  // 11. TREASURY RULE
  // ════════════════════════════════════════════════════════
  console.log('\n⚙️  Seeding treasury rule...');

  const { data: rule } = await sb.from('treasury_rules').insert({
    user_id: userId,
    ...eid,
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

  // Schema note: migration 0036_obligations_v2 renamed manual_obligations
  // to `obligations` and added direction/currency/amount/confidence/source/
  // status/recurrence as NOT NULL columns. `amount` has no DEFAULT and is
  // enforced NOT NULL post-backfill, so every row MUST populate it. The
  // legacy `amount_usd` / `is_recurring` / `recurrence_days` / `is_active`
  // columns are still present for one release but marked DEPRECATED; we
  // populate both shapes during the migration window.
  for (const ob of monthlyObligations) {
    // Find the next 3 occurrences within 90 days
    for (let monthOffset = 0; monthOffset < 3; monthOffset++) {
      const d = new Date();
      d.setMonth(d.getMonth() + monthOffset);
      d.setDate(ob.dayOfMonth);
      if (d > new Date() && d <= daysFromNow(90)) {
        obligationRows.push({
          user_id: userId,
          ...eid,
          label: ob.label,
          description: `Monthly recurring — due on the ${ob.dayOfMonth}${ob.dayOfMonth === 1 ? 'st' : ob.dayOfMonth === 15 ? 'th' : 'th'}`,
          amount_usd: ob.amount,
          amount: ob.amount,
          currency: 'USD',
          direction: 'outflow',
          confidence: 'confirmed',
          source: 'recurring_rule',
          status: 'upcoming',
          recurrence: 'monthly',
          due_date: dateStr(d),
          is_recurring: true,
          recurrence_days: 30,
          is_active: true,
          tags: ['operating'],
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
        ...eid,
        label: 'Payroll Processing',
        description: 'Bi-weekly payroll via USDC',
        amount_usd: 180_000,
        amount: 180_000,
        currency: 'USD',
        asset: 'USDC',
        direction: 'outflow',
        confidence: 'confirmed',
        source: 'recurring_rule',
        status: 'upcoming',
        recurrence: 'biweekly',
        due_date: dateStr(d),
        is_recurring: true,
        recurrence_days: 14,
        is_active: true,
        tags: ['payroll'],
      });
    }
  }

  // One-time future obligations
  const oneTimeFuture = [
    { label: 'Q1 Software License Renewal', amount: 35_000,  days: 22, conf: 'confirmed' as const },
    { label: 'Marketing Campaign — Q2',      amount: 45_000,  days: 38, conf: 'expected'  as const },
    { label: 'Infrastructure Upgrade',       amount: 120_000, days: 55, conf: 'expected'  as const },
    { label: 'Consulting Services Contract', amount: 50_000,  days: 67, conf: 'estimated' as const },
    { label: 'Annual Audit Fee',             amount: 28_000,  days: 82, conf: 'confirmed' as const },
  ];

  for (const ob of oneTimeFuture) {
    obligationRows.push({
      user_id: userId,
      ...eid,
      label: ob.label,
      description: `One-time payment due in ${ob.days} days`,
      amount_usd: ob.amount,
      amount: ob.amount,
      currency: 'USD',
      direction: 'outflow',
      confidence: ob.conf,
      source: 'manual',
      status: 'upcoming',
      recurrence: 'once',
      due_date: dateStr(daysFromNow(ob.days)),
      is_recurring: false,
      is_active: true,
      tags: ['one_time'],
    });
  }

  const { data: insertedObligations, error: obErr } = await sb
    .from('obligations')
    .insert(obligationRows)
    .select('id');
  if (obErr) throw obErr;
  const obligationIds: string[] = (insertedObligations ?? []).map((o) => o.id);
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
      ...eid,
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
      ai_reasoning: 'Projected USDC balance falls below safety buffer within 30 days. Recommend onramp of $500K USDC from SVB Operating Account to cover upcoming payroll and vendor obligations.',
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
      ...eid,
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
      ai_reasoning: 'USDC holdings significantly exceed safety buffer target. Offramp $200K USDC to Chase Business Checking to optimize yield on idle stablecoin reserves.',
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
      ...eid,
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
      ai_reasoning: 'Treasury position is healthy. Total stablecoin balance of $2.15M (USDC across Ethereum + Solana) exceeds the safety buffer target of $780K with comfortable margin. No action required at this time.',
      ai_model: 'claude-sonnet-4-6',
      status: 'auto_executed',
      requires_approval: false,
      executed_at: ts(daysAgo(7)),
      created_at: ts(daysAgo(7)),
      updated_at: ts(daysAgo(7)),
      expires_at: ts(daysAgo(6)),
    },
    // Pending onramp recommendation (requires approval) — high-value, 1 day old
    {
      user_id: userId,
      ...eid,
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
      ai_reasoning: 'Upcoming obligations over the next 30 days total $920K, including $180K bi-weekly payroll, $95K Acme Corp invoice, $88.5K Nexus Digital invoice, and infrastructure upgrade of $120K. Current USDC balance provides only 2.3× coverage vs. required 1.5× safety buffer. Recommend onramp of $350K USDC from SVB Operating Account.',
      ai_model: 'claude-sonnet-4-6',
      status: 'pending_approval',
      requires_approval: true,
      created_at: ts(daysAgo(1)),
      updated_at: ts(daysAgo(1)),
      expires_at: ts(daysFromNow(23)),
    },
    // Pending offramp — idle cash rebalance, 2 days old
    {
      user_id: userId,
      ...eid,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: totalBank,
      total_crypto_balance_usd: totalCrypto,
      obligations_in_window_usd: 520_000,
      safety_buffer_target_usd: 780_000,
      obligation_lookahead_days: 30,
      action: 'offramp',
      recommended_amount_usd: 150_000,
      bank_account_id: mercuryBank.id,
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'USDC reserves sit at 2.76× the 30-day safety buffer, leaving ~$590K idle beyond the working envelope. Offramping $150K USDC to Mercury would lock in short-term treasury yield (~4.8% APY) without impacting coverage of upcoming obligations. Confidence is moderate — holding USDC may be preferable if an acquisition or capex event is imminent.',
      ai_model: 'claude-sonnet-4-6',
      status: 'pending_approval',
      requires_approval: true,
      created_at: ts(daysAgo(2)),
      updated_at: ts(daysAgo(2)),
      expires_at: ts(daysFromNow(22)),
    },
    // Pending onramp — Solana chain, mid-size, 3 days old
    {
      user_id: userId,
      ...eid,
      treasury_rule_id: ruleId,
      total_bank_balance_usd: totalBank,
      total_crypto_balance_usd: totalCrypto,
      obligations_in_window_usd: 610_000,
      safety_buffer_target_usd: 915_000,
      obligation_lookahead_days: 30,
      action: 'onramp',
      recommended_amount_usd: 225_000,
      bank_account_id: chaseBank.id,
      stablecoin_token: 'USDC',
      stablecoin_chain: 'solana',
      ai_reasoning: 'Solana wallets hold $75K USDC against $180K of scheduled Solana-settled vendor payments over the next 21 days (Jito Labs infra, Helius RPC, Neon EVM). Recommend onramp of $225K USDC via Chase → Solana to restore per-chain coverage before the Jito invoice clears on day 14.',
      ai_model: 'claude-sonnet-4-6',
      status: 'pending_approval',
      requires_approval: true,
      created_at: ts(daysAgo(3)),
      updated_at: ts(daysAgo(3)),
      expires_at: ts(daysFromNow(21)),
    },
    // Rejected recommendation (declined by user last month)
    {
      user_id: userId,
      ...eid,
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

  const { data: insertedRecs, error: recErr } = await sb
    .from('ai_recommendations')
    .insert(aiRows)
    .select('id, status, action, recommended_amount_usd, created_at');
  if (recErr) throw recErr;
  console.log(`✓ ${aiRows.length} AI recommendations`);

  // ════════════════════════════════════════════════════════
  // 13b. NOTIFICATIONS (bell badge + NotificationsPanel feed)
  // ════════════════════════════════════════════════════════
  // Populates the Topbar bell so the treasury_ai surface isn't empty.
  // Unread rows drive the badge count; read rows fill out the panel history.
  // Event types mirror src/lib/notifications/events.ts.
  console.log('\n🔔 Seeding notifications...');

  const pendingRecs = (insertedRecs ?? []).filter((r) => r.status === 'pending_approval');
  const executedRec = (insertedRecs ?? []).find((r) => r.status === 'executed' && r.action === 'offramp');
  const autoRec     = (insertedRecs ?? []).find((r) => r.status === 'auto_executed');
  const rejectedRec = (insertedRecs ?? []).find((r) => r.status === 'rejected');

  const fmtAmt = (n: string | number | null | undefined) =>
    n == null ? '' : '$' + Math.round(Number(n)).toLocaleString();
  const actionLabel = (a: string) =>
    a === 'onramp' ? 'On-ramp' : a === 'offramp' ? 'Off-ramp' : 'No action';

  const notificationRows: any[] = [];

  // Unread: one recommendation_pending per pending rec → feeds the bell badge
  for (const rec of pendingRecs) {
    notificationRows.push({
      user_id: userId,
      ...eid,
      event_type: 'recommendation_pending',
      category: 'treasury_ai',
      title: 'New AI Recommendation — Approval Required',
      body: `${actionLabel(rec.action)} ${fmtAmt(rec.recommended_amount_usd)}`,
      link: `/treasury?reviewRec=${rec.id}`,
      metadata: { recommendationId: rec.id, action: rec.action, amount: rec.recommended_amount_usd },
      read: false,
      emailed: true,
      created_at: rec.created_at,
    });
  }

  // Read history: approved, auto-executed, rejected → panel shows activity log
  if (executedRec) {
    notificationRows.push({
      user_id: userId,
      ...eid,
      event_type: 'recommendation_approved',
      category: 'treasury_ai',
      title: 'AI Recommendation Approved & Executed',
      body: `${actionLabel(executedRec.action)} ${fmtAmt(executedRec.recommended_amount_usd)} completed`,
      link: '/treasury',
      metadata: { recommendationId: executedRec.id },
      read: true,
      emailed: true,
      created_at: ts(daysAgo(19)),
    });
  }
  if (autoRec) {
    notificationRows.push({
      user_id: userId,
      ...eid,
      event_type: 'recommendation_auto_executed',
      category: 'treasury_ai',
      title: 'AI Recommendation Auto-Executed',
      body: 'Daily analysis: no action required — treasury position healthy',
      link: '/treasury',
      metadata: { recommendationId: autoRec.id },
      read: true,
      emailed: false,
      created_at: ts(daysAgo(7)),
    });
  }
  if (rejectedRec) {
    notificationRows.push({
      user_id: userId,
      ...eid,
      event_type: 'recommendation_rejected',
      category: 'treasury_ai',
      title: 'AI Recommendation Rejected',
      body: `${actionLabel(rejectedRec.action)} ${fmtAmt(rejectedRec.recommended_amount_usd)} declined`,
      link: '/treasury',
      metadata: { recommendationId: rejectedRec.id, reason: 'Holding reserves for Q2 expansion' },
      read: true,
      emailed: true,
      created_at: ts(daysAgo(40)),
    });
  }

  // Unread: one daily analysis nudge so the bell shows >3 unread
  notificationRows.push({
    user_id: userId,
    ...eid,
    event_type: 'recommendation_daily',
    category: 'treasury_ai',
    title: 'Daily AI Treasury Analysis',
    body: 'Today\'s analysis surfaced 3 recommendations awaiting your review',
    link: '/treasury',
    metadata: { pendingCount: pendingRecs.length },
    read: false,
    emailed: false,
    created_at: ts(daysAgo(1)),
  });

  if (notificationRows.length > 0) {
    const { error: notifErr } = await sb.from('notifications').insert(notificationRows);
    if (notifErr) throw notifErr;
  }
  console.log(`✓ ${notificationRows.length} notifications (${pendingRecs.length + 1} unread)`);

  // ════════════════════════════════════════════════════════
  // 13c. TREASURY INSIGHTS (proactive detector feed)
  // ════════════════════════════════════════════════════════
  // Populates the InsightFeed card on Treasury AI → Overview tab. One row
  // per detector type so the feed demonstrates the full taxonomy, with
  // varied state (new / viewed / dismissed / acted_on) so the state
  // machine is observable without running the cron.
  // Schema: supabase/migrations/0037_treasury_insights.sql
  console.log('\n💡 Seeding treasury insights...');

  const insightRows: any[] = [
    // CRITICAL — unread, hits the bell as insight_critical
    {
      user_id: userId,
      ...eid,
      detector_name: 'liquidity-buffer',
      insight_type: 'liquidity_below_buffer',
      severity: 'critical',
      state: 'new',
      title: 'Projected USDC balance falls below safety buffer',
      summary: 'Over the next 14 days, projected minimum balance is $620K vs. required safety buffer of $780K. Shortfall driven by $180K bi-weekly payroll on day 7 + $95K Acme Corp invoice on day 11.',
      ai_reasoning: 'Forecast engine projects a 3-day dip below the 1.5× buffer between day 7 and day 11 of the forecast window. Recommended action is a $350K USDC onramp from SVB Operating Account, which restores coverage for the full 30-day window. This insight is linked to the pending AI recommendation in the approvals queue — approving the recommendation resolves the insight.',
      ai_model: 'claude-sonnet-4-6',
      rationale: {
        projected_min_usd: 620_000,
        required_buffer_usd: 780_000,
        shortfall_window_days: 3,
        driving_obligations: ['payroll_day7', 'acme_invoice_day11'],
      },
      recommended_action: {
        type: 'transfer',
        fromVenueId: svbBank.id,
        toVenueId: wallets[0].id,
        asset: 'USDC',
        amount: 350_000,
        amountUsd: 350_000,
        metadata: { direction: 'onramp', chain: 'ethereum' },
      },
      policy_verdict: 'require_approval',
      policy_reason: 'AI-initiated movement — always requires human approval per policy invariant',
      impact_dollar_value: 350_000,
      impact_buffer_days: 18,
      confidence: 0.92,
      data_freshness: 'fresh',
      supporting_data: { forecast_window_days: 30, obligations_count: 12 },
      dedup_key: 'liquidity_below_buffer:default:14d',
      created_at: ts(daysAgo(1)),
      updated_at: ts(daysAgo(1)),
      expires_at: ts(daysFromNow(2)),
    },

    // CRITICAL — concentration breach on a single vault
    {
      user_id: userId,
      ...eid,
      detector_name: 'concentration',
      insight_type: 'concentration_breach',
      severity: 'critical',
      state: 'new',
      title: 'Fasanara mm-EUREKA exceeds single-vault cap',
      summary: 'Position of $500K in Fasanara mm-EUREKA represents 23.3% of total stablecoin treasury, exceeding the 15% Balanced profile per-vault cap.',
      ai_reasoning: null,
      ai_model: null,
      rationale: {
        venue_id: 'fasanara_mm_eureka',
        position_usd: 500_000,
        total_treasury_usd: 2_150_000,
        concentration_pct: 23.3,
        cap_pct: 15.0,
        overage_usd: 177_500,
      },
      recommended_action: {
        type: 'yield_withdraw',
        fromVenueId: 'fasanara_mm_eureka',
        toVenueId: 'spiko_usdc',
        asset: 'USDC',
        amount: 178_000,
        amountUsd: 178_000,
      },
      policy_verdict: 'require_approval',
      policy_reason: 'AI-initiated movement — always requires human approval',
      impact_dollar_value: 178_000,
      impact_apy_delta_bps: -20,
      confidence: 1.0,
      venue_category: 'tokenized_mmf',
      data_freshness: 'fresh',
      supporting_data: { profile: 'balanced', aum_tier: 'scale' },
      dedup_key: 'concentration_breach:fasanara_mm_eureka:balanced',
      created_at: ts(daysAgo(2)),
      updated_at: ts(daysAgo(2)),
      expires_at: ts(daysFromNow(2)),
    },

    // WARNING — yield drop on Aave
    {
      user_id: userId,
      ...eid,
      detector_name: 'yield-drop',
      insight_type: 'yield_drop',
      severity: 'warning',
      state: 'new',
      title: 'Aave v3 USDC supply APY dropped 120 bps',
      summary: 'Aave v3 Ethereum USDC supply APY fell from 5.4% → 4.2% over the last 7 days. Your $275K position now yields ~$3.3K less annualized vs. the 7-day high.',
      ai_reasoning: null,
      ai_model: null,
      rationale: {
        venue_id: 'aave_v3_usdc_ethereum',
        prior_apy_bps: 540,
        current_apy_bps: 420,
        delta_bps: -120,
        position_usd: 275_000,
        annualized_yield_delta_usd: -3_300,
      },
      recommended_action: null,
      policy_verdict: null,
      policy_reason: null,
      impact_dollar_value: -3_300,
      impact_apy_delta_bps: -120,
      confidence: 1.0,
      venue_category: 'defi_lending',
      data_freshness: 'fresh',
      supporting_data: { observation_window_days: 7 },
      dedup_key: 'yield_drop:aave_v3_usdc_ethereum',
      created_at: ts(daysAgo(1)),
      updated_at: ts(daysAgo(1)),
      expires_at: ts(daysFromNow(2)),
    },

    // WARNING — yield opportunity surfacing a better venue
    {
      user_id: userId,
      ...eid,
      detector_name: 'yield-opportunity',
      insight_type: 'yield_opportunity',
      severity: 'warning',
      state: 'new',
      title: 'Spiko USDC offering 4.8% — 60 bps over current blended',
      summary: 'Spiko USDC tokenized money market fund is yielding 4.8% APY with $47M TVL. Rebalancing $500K from your idle Ethereum wallet would add ~$3K annualized yield without breaching concentration caps.',
      ai_reasoning: null,
      ai_model: null,
      rationale: {
        venue_id: 'spiko_usdc',
        venue_apy_bps: 480,
        current_blended_apy_bps: 420,
        delta_bps: 60,
        tvl_usd: 47_000_000,
        proposed_deposit_usd: 500_000,
      },
      recommended_action: {
        type: 'yield_deposit',
        fromVenueId: wallets[0].id,
        toVenueId: 'spiko_usdc',
        asset: 'USDC',
        amount: 500_000,
        amountUsd: 500_000,
      },
      policy_verdict: 'require_approval',
      policy_reason: 'AI-initiated movement — always requires human approval',
      impact_dollar_value: 3_000,
      impact_apy_delta_bps: 60,
      confidence: 0.85,
      venue_category: 'tokenized_mmf',
      data_freshness: 'fresh',
      supporting_data: {},
      dedup_key: 'yield_opportunity:spiko_usdc:USDC',
      created_at: ts(daysAgo(1)),
      updated_at: ts(daysAgo(1)),
      expires_at: ts(daysFromNow(2)),
    },

    // INFO — idle cash yield opportunity (viewed but not acted)
    {
      user_id: userId,
      ...eid,
      detector_name: 'yield-idle-opportunity',
      insight_type: 'yield_idle_opportunity',
      severity: 'info',
      state: 'viewed',
      title: '$590K USDC sitting idle on-chain',
      summary: 'Ethereum Treasury Main wallet holds $590K USDC above the 30-day working envelope. Deploying to any A-tier venue would add ~$28K annualized yield.',
      ai_reasoning: null,
      ai_model: null,
      rationale: {
        wallet_id: wallets[0].id,
        idle_usd: 590_000,
        working_envelope_usd: 260_000,
        best_venue_apy_bps: 480,
        annualized_yield_potential_usd: 28_320,
      },
      recommended_action: null,
      policy_verdict: null,
      policy_reason: null,
      impact_dollar_value: 28_320,
      impact_apy_delta_bps: 480,
      confidence: 0.9,
      venue_category: null,
      data_freshness: 'fresh',
      supporting_data: { wallet_label: 'Treasury Main' },
      dedup_key: 'yield_idle_opportunity:treasury_main:USDC',
      created_at: ts(daysAgo(3)),
      updated_at: ts(daysAgo(2)),
      expires_at: ts(daysFromNow(1)),
      viewed_at: ts(daysAgo(2)),
    },

    // INFO — concentration warning (not yet a breach)
    {
      user_id: userId,
      ...eid,
      detector_name: 'concentration',
      insight_type: 'concentration_warning',
      severity: 'info',
      state: 'viewed',
      title: 'USDC concentration at 82% of treasury',
      summary: 'USDC accounts for 82% of stablecoin treasury across all venues. Balanced profile recommends diversifying toward USDT or tokenized treasury funds above 75%.',
      ai_reasoning: null,
      ai_model: null,
      rationale: {
        asset: 'USDC',
        asset_share_pct: 82.0,
        soft_cap_pct: 75.0,
        hard_cap_pct: 90.0,
      },
      recommended_action: null,
      policy_verdict: null,
      policy_reason: null,
      impact_dollar_value: null,
      confidence: 1.0,
      venue_category: null,
      data_freshness: 'fresh',
      supporting_data: { profile: 'balanced' },
      dedup_key: 'concentration_warning:USDC:balanced',
      created_at: ts(daysAgo(2)),
      updated_at: ts(daysAgo(1)),
      expires_at: ts(daysFromNow(1)),
      viewed_at: ts(daysAgo(1)),
    },

    // DISMISSED — shows state machine works
    {
      user_id: userId,
      ...eid,
      detector_name: 'yield-opportunity',
      insight_type: 'yield_opportunity',
      severity: 'info',
      state: 'dismissed',
      title: 'Ethena sUSDe yield jumped 40 bps',
      summary: 'Ethena sUSDe APY rose from 8.2% to 8.6%. Synthetic exposure, not recommended for Balanced profile.',
      ai_reasoning: null,
      ai_model: null,
      rationale: { venue_id: 'ethena_susde', delta_bps: 40 },
      recommended_action: null,
      policy_verdict: null,
      policy_reason: null,
      impact_apy_delta_bps: 40,
      confidence: 0.6,
      venue_category: 'defi_yield',
      data_freshness: 'fresh',
      supporting_data: {},
      dedup_key: 'yield_opportunity:ethena_susde:USDC',
      cooldown_until: ts(daysFromNow(1)),
      created_at: ts(daysAgo(4)),
      updated_at: ts(daysAgo(3)),
      expires_at: ts(daysFromNow(0)),
      viewed_at: ts(daysAgo(3)),
      dismissed_at: ts(daysAgo(3)),
    },

    // ACTED_ON — completes the state machine coverage
    {
      user_id: userId,
      ...eid,
      detector_name: 'liquidity-idle',
      insight_type: 'liquidity_idle_cash',
      severity: 'info',
      state: 'acted_on',
      title: 'Idle USDC in Chase operating account',
      summary: '$250K USDC equivalent sitting unallocated in Chase beyond the 14-day working envelope.',
      ai_reasoning: null,
      ai_model: null,
      rationale: { bank_id: chaseBank.id, idle_usd: 250_000 },
      recommended_action: null,
      policy_verdict: null,
      policy_reason: null,
      impact_dollar_value: 250_000,
      confidence: 0.9,
      venue_category: null,
      data_freshness: 'fresh',
      supporting_data: {},
      dedup_key: 'liquidity_idle_cash:chase:USD',
      created_at: ts(daysAgo(10)),
      updated_at: ts(daysAgo(9)),
      expires_at: ts(daysAgo(8)),
      viewed_at: ts(daysAgo(9)),
      acted_on_at: ts(daysAgo(9)),
    },
  ];

  const { error: insightErr } = await sb.from('treasury_insights').insert(insightRows);
  if (insightErr) throw insightErr;
  const newCritical = insightRows.filter((i) => i.state === 'new' && i.severity === 'critical').length;
  const newWarning  = insightRows.filter((i) => i.state === 'new' && i.severity === 'warning').length;
  console.log(`✓ ${insightRows.length} treasury insights (${newCritical} critical, ${newWarning} warning, ${insightRows.length - newCritical - newWarning} info/historical)`);

  // Add a couple of bell notifications for the critical insights so the
  // InsightFeed and bell badge tell a consistent story on fresh seed.
  const criticalInsightRows = insightRows.filter((i) => i.state === 'new' && i.severity === 'critical');
  if (criticalInsightRows.length > 0) {
    const insightNotifs = criticalInsightRows.map((i) => ({
      user_id: userId,
      ...eid,
      event_type: 'insight_critical',
      category: 'treasury_ai',
      title: `Critical insight: ${i.title}`,
      body: i.summary.slice(0, 180),
      link: '/treasury',
      metadata: { insightType: i.insight_type, detectorName: i.detector_name },
      read: false,
      emailed: true,
      created_at: i.created_at,
    }));
    const { error: insErr } = await sb.from('notifications').insert(insightNotifs);
    if (insErr) throw insErr;
    console.log(`✓ ${insightNotifs.length} insight_critical notifications`);
  }

  // ════════════════════════════════════════════════════════
  // 13d. POLICY ENGINE (config tables — draft version)
  // ════════════════════════════════════════════════════════
  // Seeds a full policy hierarchy so the policy engine has something to
  // evaluate end-to-end on a fresh install:
  //   policy_policies → policy_versions (draft) → policy_rules +
  //   policy_hard_limits + policy_approval_chains
  //
  // The version is intentionally left in 'draft' status:
  //   1. Children (rules, hard_limits, chains) can only be mutated while
  //      the parent version is 'draft' (trigger
  //      `policy_child_frozen_when_parent_not_draft`). Once 'active' they
  //      cannot be re-seeded on a subsequent `npm run seed` because the
  //      cascade delete from policy_policies hits the row-level trigger.
  //   2. Demo users can click "Activate" in the UI to exercise the full
  //      end-to-end evaluation path.
  //
  // Runtime/audit tables (policy_evaluations, policy_approval_requests,
  // policy_activation_events) are deliberately NOT seeded — they are
  // append-only via `_no_delete` rewrite rules and would poison re-seeds.
  // Schema: supabase/migrations/0038_policy_engine_schema.sql
  if (enterpriseId) {
    console.log('\n🛡️  Seeding policy engine (config tables)...');

    // Policy data is cleaned in cleanUserData() above.
    const { data: policyRow, error: policyErr } = await sb
      .from('policy_policies')
      .insert({
        enterprise_id: enterpriseId,
        name: 'Standard Treasury Policy',
        active_version_id: null, // set below after version exists
      })
      .select('id')
      .single();
    if (policyErr) throw policyErr;

    const { data: versionRow, error: versionErr } = await sb
      .from('policy_versions')
      .insert({
        enterprise_id: enterpriseId,
        version_number: 1,
        status: 'draft',
        name: 'Standard Policy v1 (draft)',
        created_by: userId,
      })
      .select('id')
      .single();
    if (versionErr) throw versionErr;
    const versionId = versionRow.id;

    // ── Approval chains ───────────────────────────────────────────
    const { data: chains, error: chainErr } = await sb
      .from('policy_approval_chains')
      .insert([
        {
          version_id: versionId,
          name: 'Single-approver (under $100K)',
          slots: [{ slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury Manager' }],
          trigger_condition: null,
          priority: 10,
          expiration_hours: 24,
          created_by: userId,
        },
        {
          version_id: versionId,
          name: 'Dual approval (over $100K)',
          slots: [
            { slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury Manager' },
            { slot_index: 1, minimum_role: 'cfo', label: 'CFO or delegate' },
          ],
          trigger_condition: {
            kind: 'amount_compare',
            attr: 'transfer.amount',
            op: '>=',
            value: { amount: '100000', currency: 'USD' },
          },
          priority: 20,
          expiration_hours: 48,
          created_by: userId,
        },
      ])
      .select('id, name');
    if (chainErr) throw chainErr;
    const singleChain = chains.find((c) => c.name.startsWith('Single'))!;
    const dualChain   = chains.find((c) => c.name.startsWith('Dual'))!;

    // ── Hard limits ──────────────────────────────────────────────
    // Typed structural limits — NOT condition-DSL rules. One per limit_type.
    const { error: hlErr } = await sb.from('policy_hard_limits').insert([
      {
        version_id: versionId,
        limit_type: 'min_cash_reserve_usd',
        name: 'Minimum cash reserve (fiat + stablecoin)',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
        created_by: userId,
      },
      {
        version_id: versionId,
        limit_type: 'max_single_asset_concentration_pct',
        name: 'Max single-asset concentration',
        limit_value: '75',
        limit_currency: null,
        scope: {},
        created_by: userId,
      },
      {
        version_id: versionId,
        limit_type: 'max_daily_outflow_usd',
        name: 'Max 24h outflow',
        limit_value: '500000',
        limit_currency: 'USD',
        scope: {},
        created_by: userId,
      },
      {
        version_id: versionId,
        limit_type: 'max_30day_outflow_usd',
        name: 'Max 30-day outflow',
        limit_value: '5000000',
        limit_currency: 'USD',
        scope: {},
        created_by: userId,
      },
      {
        version_id: versionId,
        limit_type: 'obligation_coverage_days',
        name: 'Minimum obligation coverage window',
        limit_value: '30',
        limit_currency: null,
        scope: {},
        created_by: userId,
      },
    ]);
    if (hlErr) throw hlErr;

    // ── Rules (condition IR — must match schemas/ir.schema.ts) ───
    const { error: rulesErr } = await sb.from('policy_rules').insert([
      // 1. Low-value auto-approval — allow transfers under $10K
      {
        version_id: versionId,
        rule_type: 'approval_threshold',
        name: 'Auto-approve transfers under $10K',
        rationale: 'Low-value day-to-day vendor payments do not need manual review. Keeps treasurer focused on material movements.',
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '<',
          value: { amount: '10000', currency: 'USD' },
        },
        verdict: 'allow_auto',
        verdict_chain_id: null,
        priority: 10,
        created_by: userId,
      },
      // 2. Mid-value single approver — transfers $10K–$100K
      {
        version_id: versionId,
        rule_type: 'approval_threshold',
        name: 'Single-approver review for $10K–$100K',
        rationale: 'Everyday operational payments above the auto-approve floor still need a human eye.',
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: 'between',
          value: { amount: '10000', currency: 'USD' },
          value_upper: { amount: '100000', currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: singleChain.id,
        priority: 20,
        created_by: userId,
      },
      // 3. High-value dual approver — transfers $100K+
      {
        version_id: versionId,
        rule_type: 'approval_threshold',
        name: 'Dual approval for transfers $100K+',
        rationale: 'Material movements require treasurer + CFO sign-off. Mirrors SOX-style segregation of duties for large outflows.',
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>=',
          value: { amount: '100000', currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: dualChain.id,
        priority: 30,
        created_by: userId,
      },
      // 4. Sanctions block — any transfer with sanctioned counterparty
      {
        version_id: versionId,
        rule_type: 'counterparty',
        name: 'Block sanctioned counterparties',
        rationale: 'Transfers to or from counterparties flagged as sanctioned or partial-match must be blocked unconditionally.',
        condition: {
          kind: 'sanctions_status',
          op: 'in',
          values: ['sanctioned', 'partial_match'],
        },
        verdict: 'block',
        verdict_chain_id: null,
        priority: 5, // evaluates before approval-threshold rules
        created_by: userId,
      },
      // 5. AI-initiated floor — every AI-initiated movement requires approval
      {
        version_id: versionId,
        rule_type: 'approval_threshold',
        name: 'AI-initiated movements always require approval',
        rationale: 'Vantor invariant: AI-initiated money movement never auto-executes, regardless of amount. Reinforces the system-level default-deny for non-human initiators.',
        condition: {
          kind: 'string_compare',
          attr: 'transfer.initiator_type',
          op: 'in',
          value: 'ai_recommendation',
        },
        verdict: 'require_approval',
        verdict_chain_id: singleChain.id,
        priority: 40,
        created_by: userId,
      },
    ]);
    if (rulesErr) throw rulesErr;

    // Point the policy at its draft version
    const { error: updErr } = await sb
      .from('policy_policies')
      .update({ active_version_id: versionId })
      .eq('id', policyRow.id);
    if (updErr) throw updErr;

    console.log('✓ policy v1 (draft) with 5 rules, 5 hard limits, 2 approval chains');
  } else {
    console.log('\n⏭  Skipping policy engine seed (no enterprise_id)');
  }

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

  // treasury_forecasts was dropped in migration 0039. It is replaced by
  // a treasury_state_snapshots row (frozen positions + fx rates) plus a
  // forecast_snapshots row (projection + scenario) that FK-links back to
  // the state snapshot. Only seeded when the test enterprise is set —
  // both tables have NOT NULL enterprise_id.
  if (enterpriseId) {
    const currentFiatUsd = totalBank;
    const currentStableUsd = totalCrypto; // all USDC per seed
    const currentDefiUsd = 0;             // none yet in seed
    const totalValueUsd = currentFiatUsd + currentStableUsd + currentDefiUsd;

    const positions = [
      // Stablecoin positions (one per seeded wallet label, approximate)
      { assetSymbol: 'USDC', chain: 'ethereum', venueKind: 'wallet', venueId: wallets[0].id, amount: 850_000, unitPriceUsd: 1, valueUsd: 850_000 },
      { assetSymbol: 'USDC', chain: 'ethereum', venueKind: 'wallet', venueId: wallets[1].id, amount: 150_000, unitPriceUsd: 1, valueUsd: 150_000 },
      { assetSymbol: 'USDC', chain: 'ethereum', venueKind: 'wallet', venueId: wallets[2].id, amount: 50_000,  unitPriceUsd: 1, valueUsd: 50_000  },
      { assetSymbol: 'USDC', chain: 'solana',   venueKind: 'wallet', venueId: wallets[3].id, amount: 125_000, unitPriceUsd: 1, valueUsd: 125_000 },
      { assetSymbol: 'USDC', chain: 'solana',   venueKind: 'wallet', venueId: wallets[4].id, amount: 25_000,  unitPriceUsd: 1, valueUsd: 25_000  },
      // Fiat positions (one per seeded bank)
      { assetSymbol: 'USD', chain: null, venueKind: 'bank', venueId: chaseBank.id,   amount: 450_000,   unitPriceUsd: 1, valueUsd: 450_000 },
      { assetSymbol: 'USD', chain: null, venueKind: 'bank', venueId: svbBank.id,     amount: 1_200_000, unitPriceUsd: 1, valueUsd: 1_200_000 },
      { assetSymbol: 'USD', chain: null, venueKind: 'bank', venueId: mercuryBank.id, amount: 85_000,    unitPriceUsd: 1, valueUsd: 85_000 },
    ];

    const { data: stateSnap, error: ssErr } = await sb
      .from('treasury_state_snapshots')
      .insert({
        enterprise_id: enterpriseId,
        taken_at: ts(new Date()),
        taken_by: userId,
        trigger: 'scheduled',
        base_currency: 'USD',
        total_value_base_usd: totalValueUsd,
        total_fiat_base_usd: currentFiatUsd,
        total_stablecoin_base_usd: currentStableUsd,
        total_defi_base_usd: currentDefiUsd,
        positions,
        fx_rates: { 'USD/USD': 1.0 },
      })
      .select('id')
      .single();
    if (ssErr) throw ssErr;

    // Three scenarios off the same state snapshot so the Forecasting tab
    // can render scenario comparisons out of the box.
    const forecastSummary =
      `Treasury forecast over the next 90 days starts at $${(totalValueUsd / 1_000_000).toFixed(2)}M total value. ` +
      `Key obligations include bi-weekly payroll ($180K), upcoming vendor invoices ($443K), and one-time infrastructure spend ($120K). ` +
      `A pending $350K onramp keeps the safety buffer intact; balance stays above $780K except for brief dips around payroll dates.`;

    const forecastSnapshots = [
      {
        enterprise_id: enterpriseId,
        computed_at: ts(new Date()),
        computed_by: userId,
        treasury_state_snapshot_id: stateSnap.id,
        scenario: 'base',
        scenario_params: { obligation_confidence_floor: 'confirmed' },
        window_days: 90,
        obligation_ids: obligationIds,
        obligation_count: obligationIds.length,
        projection: { timeline: forecastData, summary: forecastSummary, breaches: [] },
        correlation_id: null,
        consumer: 'treasurer_view',
        is_hypothetical: false,
      },
      {
        enterprise_id: enterpriseId,
        computed_at: ts(new Date()),
        computed_by: userId,
        treasury_state_snapshot_id: stateSnap.id,
        scenario: 'conservative',
        scenario_params: { obligation_confidence_floor: 'expected', inflow_haircut_pct: 25 },
        window_days: 90,
        obligation_ids: obligationIds,
        obligation_count: obligationIds.length,
        projection: {
          timeline: forecastData.map((d) => ({ ...d, projectedBalanceUsd: fmt2(d.projectedBalanceUsd * 0.92) })),
          summary: 'Conservative scenario applies a 25% haircut to expected inflows; projected min balance dips to $560K on day 11 before recovering.',
          breaches: [{ date: forecastData[10]?.date, minBalance: 560_000 }],
        },
        correlation_id: null,
        consumer: 'treasurer_view',
        is_hypothetical: false,
      },
      {
        enterprise_id: enterpriseId,
        computed_at: ts(new Date()),
        computed_by: userId,
        treasury_state_snapshot_id: stateSnap.id,
        scenario: 'stress',
        scenario_params: { obligation_confidence_floor: 'estimated', inflow_haircut_pct: 50, payroll_acceleration_days: 3 },
        window_days: 90,
        obligation_ids: obligationIds,
        obligation_count: obligationIds.length,
        projection: {
          timeline: forecastData.map((d) => ({ ...d, projectedBalanceUsd: fmt2(d.projectedBalanceUsd * 0.78) })),
          summary: 'Stress scenario zeroes discretionary inflows and accelerates payroll by 3 days. Treasury drops below safety buffer from day 8-18 without corrective action.',
          breaches: [{ date: forecastData[7]?.date, minBalance: 340_000 }],
        },
        correlation_id: null,
        consumer: 'alert_eval',
        is_hypothetical: false,
      },
    ];

    const { error: fsErr } = await sb.from('forecast_snapshots').insert(forecastSnapshots);
    if (fsErr) throw fsErr;
    console.log(`✓ Treasury state snapshot + ${forecastSnapshots.length} forecast snapshots (base/conservative/stress)`);
  } else {
    console.log('⏭  Skipping treasury_state_snapshots + forecast_snapshots (no enterprise_id)');
  }

  // ════════════════════════════════════════════════════════
  // 10. COMPLIANCE — Sanctions, KYT, Travel Rule
  // ════════════════════════════════════════════════════════
  console.log('\n🛡️  Seeding compliance data...');

  // --- Sanctions Screenings ---
  const sanctionsRows = [
    {
      user_id: userId, ...eid, address: wallets[0].address, chain: 'ethereum' as const,
      result: 'clear', risk_score: 0.00, provider: 'chainalysis',
      match_details: { identifications: [] },
      screened_at: ts(daysAgo(1)), expires_at: ts(daysFromNow(0)),
    },
    {
      user_id: userId, ...eid, address: wallets[1].address, chain: 'ethereum' as const,
      result: 'clear', risk_score: 2.10, provider: 'chainalysis',
      match_details: { identifications: [] },
      screened_at: ts(daysAgo(3)), expires_at: ts(daysAgo(2)),
    },
    {
      user_id: userId, ...eid, address: wallets[3].address, chain: 'solana' as const,
      result: 'clear', risk_score: 0.50, provider: 'chainalysis',
      match_details: { identifications: [] },
      screened_at: ts(daysAgo(5)), expires_at: ts(daysAgo(4)),
    },
    {
      user_id: userId, ...eid, address: '0xDEAD000000000000000000000000000000000001', chain: 'ethereum' as const,
      result: 'sanctioned', risk_score: 100.00, provider: 'chainalysis',
      match_details: { identifications: [{ source: 'OFAC SDN', category: 'sanctions', name: 'Lazarus Group' }] },
      screened_at: ts(daysAgo(10)), expires_at: ts(daysAgo(9)),
    },
    {
      user_id: userId, ...eid, address: '0x1234567890abcdef1234567890abcdef12345678', chain: 'ethereum' as const,
      result: 'partial_match', risk_score: 45.00, provider: 'chainalysis',
      match_details: { identifications: [{ source: 'OFAC SDN', category: 'possible_match', name: 'Unknown Entity' }] },
      screened_at: ts(daysAgo(7)), expires_at: ts(daysAgo(6)),
    },
    // Most recent — pending-style (just screened)
    {
      user_id: userId, ...eid, address: wallets[2].address, chain: 'ethereum' as const,
      result: 'clear', risk_score: 1.20, provider: 'chainalysis',
      match_details: { identifications: [] },
      screened_at: ts(new Date()), expires_at: ts(daysFromNow(1)),
    },
  ];

  const { error: sanctErr } = await sb.from('sanctions_screenings').insert(sanctionsRows);
  if (sanctErr) console.error('  Sanctions error:', sanctErr.message);
  else console.log(`✓ Sanctions screenings: ${sanctionsRows.length}`);

  // --- KYT Transfers ---
  const kytTransferRows = [
    {
      user_id: userId, ...eid, external_id: `kyt-${Date.now()}-1`,
      chain: 'ethereum' as const, direction: 'sent',
      tx_hash: ethHash(), from_address: wallets[0].address,
      to_address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      token: 'USDC', amount: 50000.00, asset_amount_usd: 50000.00,
      risk_score: 1.50, cluster_name: 'Circle', cluster_category: 'exchange',
      registered_at: ts(daysAgo(2)),
    },
    {
      user_id: userId, ...eid, external_id: `kyt-${Date.now()}-2`,
      chain: 'ethereum' as const, direction: 'received',
      tx_hash: ethHash(), from_address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      to_address: wallets[0].address,
      token: 'USDT', amount: 125000.00, asset_amount_usd: 125000.00,
      risk_score: 8.30, cluster_name: 'Unknown', cluster_category: 'unhosted',
      registered_at: ts(daysAgo(5)),
    },
    {
      user_id: userId, ...eid, external_id: `kyt-${Date.now()}-3`,
      chain: 'ethereum' as const, direction: 'sent',
      tx_hash: ethHash(), from_address: wallets[1].address,
      to_address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      token: 'USDC', amount: 75000.00, asset_amount_usd: 75000.00,
      risk_score: 0.80, cluster_name: 'Aave V3', cluster_category: 'defi',
      registered_at: ts(daysAgo(8)),
    },
    {
      user_id: userId, ...eid, external_id: `kyt-${Date.now()}-4`,
      chain: 'solana' as const, direction: 'sent',
      tx_hash: solHash(), from_address: wallets[3].address,
      to_address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      token: 'USDC', amount: 30000.00, asset_amount_usd: 30000.00,
      risk_score: 2.00, cluster_name: 'Solana Pay Merchant', cluster_category: 'merchant',
      registered_at: ts(daysAgo(12)),
    },
    {
      user_id: userId, ...eid, external_id: `kyt-${Date.now()}-5`,
      chain: 'ethereum' as const, direction: 'received',
      tx_hash: ethHash(), from_address: '0xBAD0000000000000000000000000000000000001',
      to_address: wallets[0].address,
      token: 'USDC', amount: 15000.00, asset_amount_usd: 15000.00,
      risk_score: 72.50, cluster_name: 'Tornado Cash', cluster_category: 'mixing',
      registered_at: ts(daysAgo(15)),
    },
    // Most recent
    {
      user_id: userId, ...eid, external_id: `kyt-${Date.now()}-6`,
      chain: 'ethereum' as const, direction: 'sent',
      tx_hash: ethHash(), from_address: wallets[0].address,
      to_address: '0x2e988a386a799f506693793c6a5af6b54dfaabfb',
      token: 'USDC', amount: 200000.00, asset_amount_usd: 200000.00,
      risk_score: 0.30, cluster_name: 'Coinbase', cluster_category: 'exchange',
      registered_at: ts(new Date()),
    },
  ];

  const { data: kytTransfers, error: kytErr } = await sb.from('kyt_transfers').insert(kytTransferRows).select('id');
  if (kytErr) console.error('  KYT transfers error:', kytErr.message);
  else console.log(`✓ KYT transfers: ${kytTransferRows.length}`);

  // --- KYT Alerts ---
  const kytAlertRows = kytTransfers ? [
    {
      user_id: userId, ...eid, kyt_transfer_id: kytTransfers[1]?.id,
      external_alert_id: 'alert-001', severity: 'medium', status: 'resolved',
      category: 'unhosted_wallet', description: 'Received $125,000 USDT from unhosted wallet with limited transaction history.',
      reviewed_by: userId, reviewed_at: ts(daysAgo(4)),
      review_notes: 'Verified — counterparty is known OTC desk. No further action required.',
    },
    {
      user_id: userId, ...eid, kyt_transfer_id: kytTransfers[4]?.id,
      external_alert_id: 'alert-002', severity: 'high', status: 'escalated',
      category: 'mixing_service', description: 'Received $15,000 USDC from address linked to Tornado Cash mixing service.',
    },
    {
      user_id: userId, ...eid, kyt_transfer_id: kytTransfers[4]?.id,
      external_alert_id: 'alert-003', severity: 'severe', status: 'under_review',
      category: 'sanctions_exposure', description: 'Indirect exposure to OFAC-sanctioned mixing protocol via intermediary wallet.',
    },
    // Most recent — open alert
    {
      user_id: userId, ...eid, kyt_transfer_id: kytTransfers[1]?.id,
      external_alert_id: 'alert-004', severity: 'low', status: 'open',
      category: 'large_transaction', description: 'Large inbound transfer of $125,000 flagged for review per policy threshold.',
    },
  ] : [];

  if (kytAlertRows.length) {
    const { error: alertErr } = await sb.from('kyt_alerts').insert(kytAlertRows);
    if (alertErr) console.error('  KYT alerts error:', alertErr.message);
    else console.log(`✓ KYT alerts: ${kytAlertRows.length}`);
  }

  // --- Travel Rule Transfers ---
  const travelRuleRows = [
    {
      user_id: userId, ...eid, direction: 'outgoing',
      amount_usd: 50000.00,
      originator_name: 'Vantor Treasury', originator_address: '350 5th Ave, New York, NY 10118',
      originator_wallet: wallets[0].address, originator_chain: 'ethereum' as const,
      originator_vasp: 'Vantor Inc.',
      beneficiary_name: 'Circle Internet Financial', beneficiary_address: '99 High St, Boston, MA 02110',
      beneficiary_wallet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', beneficiary_chain: 'ethereum' as const,
      beneficiary_vasp: 'Circle',
      status: 'accepted', provider_ref: 'TR-20260301-001',
      sent_at: ts(daysAgo(11)), received_at: ts(daysAgo(11)),
    },
    {
      user_id: userId, ...eid, direction: 'outgoing',
      amount_usd: 75000.00,
      originator_name: 'Vantor Treasury', originator_address: '350 5th Ave, New York, NY 10118',
      originator_wallet: wallets[1].address, originator_chain: 'ethereum' as const,
      originator_vasp: 'Vantor Inc.',
      beneficiary_name: 'MakerDAO Foundation', beneficiary_address: 'George Town, Cayman Islands',
      beneficiary_wallet: '0x6B175474E89094C44Da98b954EedeAC495271d0F', beneficiary_chain: 'ethereum' as const,
      beneficiary_vasp: 'MakerDAO',
      status: 'sent', provider_ref: 'TR-20260303-002',
      sent_at: ts(daysAgo(9)),
    },
    {
      user_id: userId, ...eid, direction: 'incoming',
      amount_usd: 125000.00,
      originator_name: 'OTC Desk Ltd.', originator_address: 'Singapore',
      originator_wallet: '0xdAC17F958D2ee523a2206206994597C13D831ec7', originator_chain: 'ethereum' as const,
      originator_vasp: 'OTC Desk VASP',
      beneficiary_name: 'Vantor Treasury', beneficiary_address: '350 5th Ave, New York, NY 10118',
      beneficiary_wallet: wallets[0].address, beneficiary_chain: 'ethereum' as const,
      beneficiary_vasp: 'Vantor Inc.',
      status: 'received', provider_ref: 'TR-20260305-003',
      sent_at: ts(daysAgo(7)), received_at: ts(daysAgo(7)),
    },
    {
      user_id: userId, ...eid, direction: 'outgoing',
      amount_usd: 30000.00,
      originator_name: 'Vantor Treasury', originator_address: '350 5th Ave, New York, NY 10118',
      originator_wallet: wallets[3].address, originator_chain: 'solana' as const,
      originator_vasp: 'Vantor Inc.',
      beneficiary_name: 'Solana Pay Merchant', beneficiary_address: 'Miami, FL',
      beneficiary_wallet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', beneficiary_chain: 'solana' as const,
      beneficiary_vasp: 'SolPay Inc.',
      status: 'rejected', provider_ref: 'TR-20260228-004',
      error_message: 'Beneficiary VASP did not respond within timeout window.',
      sent_at: ts(daysAgo(12)),
    },
    // Most recent — pending
    {
      user_id: userId, ...eid, direction: 'outgoing',
      amount_usd: 200000.00,
      originator_name: 'Vantor Treasury', originator_address: '350 5th Ave, New York, NY 10118',
      originator_wallet: wallets[0].address, originator_chain: 'ethereum' as const,
      originator_vasp: 'Vantor Inc.',
      beneficiary_name: 'Coinbase Custody', beneficiary_address: '100 Pine St, San Francisco, CA 94111',
      beneficiary_wallet: '0x2e988a386a799f506693793c6a5af6b54dfaabfb', beneficiary_chain: 'ethereum' as const,
      beneficiary_vasp: 'Coinbase Inc.',
      status: 'pending', provider_ref: 'TR-20260312-005',
    },
  ];

  const { error: trErr } = await sb.from('travel_rule_transfers').insert(travelRuleRows);
  if (trErr) console.error('  Travel rule error:', trErr.message);
  else console.log(`✓ Travel rule transfers: ${travelRuleRows.length}`);

  // ════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(60));
  console.log('✅  Seed complete!\n');
  console.log('  Wallets          :', wallets.length, '(3 Ethereum + 2 Solana)');
  console.log('  Bank accounts    :', banks.length, '(Chase, SVB, Mercury, Barclays EUR, HSBC GBP, Itaú BRL, Nubank BRL, BBVA MXN)');
  console.log('  ERP configs      :', allErp.length);
  console.log('  ERP vendors      :', vendors?.length ?? 0);
  console.log('  Invoices         :', invoices?.length ?? 0);
  console.log('  Transactions     :', transactions?.length ?? 0, '(90-day history)');
  console.log('  Payments         :', payments?.length ?? 0);
  console.log('  Balance snapshots:', snapshotRows.length, '(daily × all wallets)');
  console.log('  Fiat ramps       :', fiatRows.length, '(onramp/offramp history)');
  console.log('  Yield positions  :', yieldPosCount, '(4 DeFi + 3 tokenized MMFs)');
  console.log('  Yield txns       :', yieldTxCount);
  console.log('  Obligations      :', obligationRows.length, '(next 90 days)');
  console.log('  AI recommendations:', aiRows.length, `(${aiRows.filter(r => r.status === 'pending_approval').length} pending approval)`);
  console.log('  Treasury insights :', insightRows.length, `(${insightRows.filter(i => i.state === 'new' && i.severity === 'critical').length} critical new)`);
  console.log('  Forecast snapshots: 3 scenarios (base / conservative / stress) off 1 state snapshot');
  console.log('  Policy engine    : v1 draft (5 rules, 5 hard limits, 2 approval chains)');
  console.log('  Forecast         : 90-day projection');
  console.log('  Sanctions screens:', sanctionsRows.length);
  console.log('  KYT transfers    :', kytTransferRows.length);
  console.log('  KYT alerts       :', kytAlertRows.length);
  console.log('  Travel rule      :', travelRuleRows.length);
  console.log('');
  console.log('  Total bank balance  : $1,735,000');
  console.log('  Total stablecoin balance: $2,150,000 (USDC)');
  console.log('  Total AUM           : $3,885,000');
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('\n❌ Seed failed:', err.message ?? err);
  process.exit(1);
});
