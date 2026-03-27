import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';

const TEST_MODE_COOKIE = 'vantor_test_mode';

/**
 * Read test mode state from cookie.
 */
export function isTestMode(): boolean {
  const cookieStore = cookies();
  return cookieStore.get(TEST_MODE_COOKIE)?.value === '1';
}

/**
 * Returns the effective enterprise_id for DB queries.
 * In test mode, returns the shadow test enterprise; otherwise, the real one.
 */
export async function getEffectiveEnterpriseId(
  realEnterpriseId: string | null
): Promise<string | null> {
  if (!realEnterpriseId) return null;
  if (!isTestMode()) return realEnterpriseId;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', realEnterpriseId)
    .single();

  if (!data?.test_enterprise_id) {
    // Lazily create test enterprise on first access
    const testId = await ensureTestEnterprise(realEnterpriseId);
    return testId;
  }

  return data.test_enterprise_id;
}

/**
 * Ensures a test enterprise exists for the given real enterprise.
 * Creates one and seeds test data if it doesn't exist yet.
 */
export async function ensureTestEnterprise(
  realEnterpriseId: string
): Promise<string> {
  const supabase = createAdminClient();

  // Check if already exists
  const { data: existing } = await supabase
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', realEnterpriseId)
    .single();

  if (existing?.test_enterprise_id) {
    return existing.test_enterprise_id;
  }

  // Get real enterprise name
  const { data: realEnt } = await supabase
    .from('enterprises')
    .select('name')
    .eq('id', realEnterpriseId)
    .single();

  // Create shadow test enterprise
  const { data: testEnt, error } = await supabase
    .from('enterprises')
    .insert({
      name: `${realEnt?.name ?? 'Enterprise'} [TEST]`,
      status: 'active',
      is_test_enterprise: true,
      metadata: { source_enterprise_id: realEnterpriseId },
    })
    .select('id')
    .single();

  if (error || !testEnt) {
    throw new Error(`Failed to create test enterprise: ${error?.message}`);
  }

  // Link test enterprise to real enterprise
  await supabase
    .from('enterprises')
    .update({ test_enterprise_id: testEnt.id })
    .eq('id', realEnterpriseId);

  // Seed test data
  await seedTestData(testEnt.id, realEnterpriseId);

  return testEnt.id;
}

/**
 * Seeds a test enterprise with demo data. Can be called during registration
 * when we already have the test enterprise ID and a user.
 */
export async function seedTestEnterprise(
  testEnterpriseId: string,
  sourceEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<void> {
  await seedTestData(testEnterpriseId, sourceEnterpriseId, adminClient);
}

async function seedTestData(
  testEnterpriseId: string,
  sourceEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<void> {
  const supabase = adminClient || createAdminClient();

  // Get users from the real enterprise to associate test data with
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id, role')
    .eq('enterprise_id', sourceEnterpriseId);

  const primaryUser = users?.[0];
  if (!primaryUser) return;

  const userId = primaryUser.id;
  const now = new Date().toISOString();

  // 1. Seed test wallets
  const testWallets = [
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      chain: 'ethereum',
      address: '0xTEST1111111111111111111111111111111111aa',
      label: 'Test Ethereum Wallet',
      verified_at: now,
    },
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      chain: 'solana',
      address: 'TESTso1ana1111111111111111111111111111111111',
      label: 'Test Solana Wallet',
      verified_at: now,
    },
  ];
  const { data: wallets } = await supabase
    .from('wallets')
    .insert(testWallets)
    .select('id, chain');

  // 2. Seed test bank accounts
  const testBankAccounts = [
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      institution_name: 'Test Bank of America',
      account_name: 'Test Operating Account',
      account_type: 'checking',
      last4: '9999',
      currency: 'USD',
      current_balance: '1500000.00',
      balance_currency: 'USD',
      balance_as_of: now,
      is_active: true,
    },
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      institution_name: 'Test Barclays UK',
      account_name: 'Test GBP Account',
      account_type: 'checking',
      last4: '8888',
      currency: 'GBP',
      current_balance: '500000.00',
      balance_currency: 'GBP',
      balance_as_of: now,
      is_active: true,
    },
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      institution_name: 'Test Deutsche Bank',
      account_name: 'Test EUR Account',
      account_type: 'checking',
      last4: '7777',
      currency: 'EUR',
      current_balance: '500000.00',
      balance_currency: 'EUR',
      balance_as_of: now,
      is_active: true,
    },
  ];
  await supabase.from('bank_accounts').insert(testBankAccounts);

  // 3. Seed test wallet balances
  const ethWallet = wallets?.find((w) => w.chain === 'ethereum');
  const solWallet = wallets?.find((w) => w.chain === 'solana');

  const testBalances = [];
  if (ethWallet) {
    testBalances.push(
      { wallet_id: ethWallet.id, enterprise_id: testEnterpriseId, token: 'USDC', balance: '1500000.00', usd_value: '1500000.00' },
    );
  }
  if (solWallet) {
    testBalances.push(
      { wallet_id: solWallet.id, enterprise_id: testEnterpriseId, token: 'USDT', balance: '500000.00', usd_value: '500000.00' },
    );
  }
  if (testBalances.length) {
    await supabase.from('wallet_balances').insert(testBalances);
  }

  // 3b. Seed historical balance snapshots (180 days / 6 months) for charts
  const snapshots: {
    wallet_id: string;
    enterprise_id: string;
    token: string;
    balance: string;
    usd_value: string;
    snapped_at: string;
  }[] = [];

  for (let daysAgo = 180; daysAgo >= 0; daysAgo--) {
    const snapDate = new Date(Date.now() - daysAgo * 86400000).toISOString();
    // Simulate gradual growth with some variance
    const variance = () => 1 + (Math.sin(daysAgo * 0.3) * 0.06) + ((180 - daysAgo) * 0.001);

    if (ethWallet) {
      const usdcBal = (1300000 * variance()).toFixed(2);
      snapshots.push({ wallet_id: ethWallet.id, enterprise_id: testEnterpriseId, token: 'USDC', balance: usdcBal, usd_value: usdcBal, snapped_at: snapDate });
    }
    if (solWallet) {
      const usdtBal = (430000 * variance()).toFixed(2);
      snapshots.push({ wallet_id: solWallet.id, enterprise_id: testEnterpriseId, token: 'USDT', balance: usdtBal, usd_value: usdtBal, snapped_at: snapDate });
    }
  }

  if (snapshots.length) {
    await supabase.from('balance_snapshots').insert(snapshots);
  }

  // 4. Seed test ERP configurations
  const erpCredentials = Buffer.from(JSON.stringify({
    apiKey: 'test-erp-key-000',
    baseUrl: 'https://test-erp.example.com',
  })).toString('base64');

  const { data: erpConfig } = await supabase
    .from('erp_configurations')
    .insert({
      user_id: userId,
      enterprise_id: testEnterpriseId,
      provider: 'sap',
      label: 'Test SAP S/4HANA',
      credentials: erpCredentials,
      is_active: true,
      last_synced: now,
    })
    .select('id')
    .single();

  // Second ERP
  await supabase
    .from('erp_configurations')
    .insert({
      user_id: userId,
      enterprise_id: testEnterpriseId,
      provider: 'netsuite',
      label: 'Test Oracle NetSuite',
      credentials: erpCredentials,
      is_active: true,
      last_synced: now,
    });

  // 5. Seed test ERP vendors
  if (erpConfig) {
    const testVendors = [
      { erp_config_id: erpConfig.id, external_id: 'tv-001', name: 'Test Cloud Services Inc', email: 'billing@testcloud.example.com', synced_at: now },
      { erp_config_id: erpConfig.id, external_id: 'tv-002', name: 'Test Office Supplies Co', email: 'ar@testoffice.example.com', synced_at: now },
      { erp_config_id: erpConfig.id, external_id: 'tv-003', name: 'Test Legal Partners LLP', email: 'invoicing@testlegal.example.com', synced_at: now },
    ];
    const { data: vendors } = await supabase.from('erp_vendors').insert(testVendors).select('id, external_id');

    // 6. Seed test invoices from ERP
    if (vendors?.length) {
      const vendorMap = Object.fromEntries(vendors.map((v) => [v.external_id, v.id]));
      const testInvoices = [
        {
          user_id: userId,
          enterprise_id: testEnterpriseId,
          erp_config_id: erpConfig.id,
          erp_invoice_id: 'INV-TEST-001',
          vendor_id: vendorMap['tv-001'],
          invoice_number: 'INV-TEST-001',
          description: 'Monthly cloud hosting',
          amount: '4500.00',
          token: 'USDC',
          chain: 'ethereum',
          due_date: new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0],
          status: 'unpaid',
        },
        {
          user_id: userId,
          enterprise_id: testEnterpriseId,
          erp_config_id: erpConfig.id,
          erp_invoice_id: 'INV-TEST-002',
          vendor_id: vendorMap['tv-002'],
          invoice_number: 'INV-TEST-002',
          description: 'Office equipment Q1',
          amount: '2200.00',
          token: 'USDC',
          chain: 'ethereum',
          due_date: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
          status: 'unpaid',
        },
        {
          user_id: userId,
          enterprise_id: testEnterpriseId,
          erp_config_id: erpConfig.id,
          erp_invoice_id: 'INV-TEST-003',
          vendor_id: vendorMap['tv-003'],
          invoice_number: 'INV-TEST-003',
          description: 'Legal retainer - March',
          amount: '8000.00',
          token: 'USDC',
          chain: 'ethereum',
          due_date: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0],
          status: 'overdue',
        },
      ];
      await supabase.from('invoices').insert(testInvoices);
    }
  }

  // 7. Seed test treasury rules
  await supabase.from('treasury_rules').insert({
    enterprise_id: testEnterpriseId,
    user_id: userId,
    is_active: true,
    safety_buffer_multiplier: '1.5',
    obligation_lookahead_days: 14,
    approval_threshold_usd: '10000',
    target_stablecoin: 'USDC',
    target_chain: 'ethereum',
  });

  // 8. Seed test obligations
  const obligations = [
    {
      enterprise_id: testEnterpriseId,
      user_id: userId,
      label: 'Test Vendor Payment',
      amount_usd: '15000',
      due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      recurrence: 'monthly',
      category: 'vendor',
      is_active: true,
    },
    {
      enterprise_id: testEnterpriseId,
      user_id: userId,
      label: 'Test Payroll',
      amount_usd: '80000',
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      recurrence: 'biweekly',
      category: 'payroll',
      is_active: true,
    },
    {
      enterprise_id: testEnterpriseId,
      user_id: userId,
      label: 'Test Office Rent',
      amount_usd: '12000',
      due_date: new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0],
      recurrence: 'monthly',
      category: 'rent',
      is_active: true,
    },
  ];
  await supabase.from('manual_obligations').insert(obligations);

  // 9. Seed a few test fiat transactions
  const testFiatTxns = [
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      direction: 'offramp',
      crypto_token: 'USDC',
      crypto_amount: '10000.00',
      fiat_amount: '9985.00',
      fiat_currency: 'USD',
      exchange_rate: '0.9985',
      fee_amount: '15.00',
      status: 'completed',
      created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
    {
      user_id: userId,
      enterprise_id: testEnterpriseId,
      direction: 'onramp',
      crypto_token: 'USDC',
      crypto_amount: '25000.00',
      fiat_amount: '25050.00',
      fiat_currency: 'USD',
      exchange_rate: '1.002',
      fee_amount: '25.00',
      status: 'completed',
      created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
  ];
  await supabase.from('fiat_transactions').insert(testFiatTxns);
}
