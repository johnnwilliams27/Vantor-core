# Test Mode Seed Data & Tier Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed comprehensive dummy data for Lite test mode enterprises, and wipe it clean when upgrading to a paid tier (clean sandbox).

**Architecture:** Domain-based seed modules in `src/lib/test-mode/seed/` each export a function that inserts scoped data. An orchestrator calls them in dependency order during enterprise creation. On upgrade (Lite → paid), a wipe function deletes all test data in reverse order. The upgrade flow gains a sandbox warning step and persists KYB/KYC progress so users can resume.

**Tech Stack:** Next.js 14 App Router, Supabase (admin client), NextAuth v4 (JWT), TypeScript

---

## File Structure

### New Files
- `src/lib/test-mode/seed/wallets.ts` — Seed wallets, balances, and 180-day balance snapshots
- `src/lib/test-mode/seed/banking.ts` — Seed bank accounts and fiat transactions
- `src/lib/test-mode/seed/erp.ts` — Seed ERP configs, vendors, invoices, GL postings
- `src/lib/test-mode/seed/transactions.ts` — Seed on-chain transactions, payments, payment attempts
- `src/lib/test-mode/seed/swaps.ts` — Seed token swap records
- `src/lib/test-mode/seed/bridges.ts` — Seed cross-chain bridge transfers
- `src/lib/test-mode/seed/treasury.ts` — Seed treasury rules, obligations, AI recommendations, forecasts, simulation runs
- `src/lib/test-mode/seed/yield.ts` — Seed yield positions and yield transactions
- `src/lib/test-mode/seed/compliance.ts` — Seed sanctions screenings, KYT transfers/alerts, travel rule records
- `src/lib/test-mode/seed/audit.ts` — Seed audit log entries
- `src/lib/test-mode/seed/seed-all.ts` — Orchestrator that calls all modules in dependency order
- `src/lib/test-mode/seed/wipe.ts` — Delete all test enterprise data in reverse dependency order
- `src/lib/test-mode/seed/helpers.ts` — Shared date/random/hash utilities for seed modules
- `supabase/migrations/0017_test_data_wiped.sql` — Add `test_data_wiped_at` column to enterprises
- `src/components/billing/SandboxWarningStep.tsx` — New upgrade flow step: sandbox transition notice

### Modified Files
- `src/lib/test-mode/helpers.ts` — Replace `seedTestData()` with call to `seedAll()`, update `ensureTestEnterprise()` to check `test_data_wiped_at`
- `src/app/api/auth/register/route.ts` — Call `seedAll()` instead of `seedTestEnterprise()`
- `src/components/billing/UpgradeFlow.tsx` — Add sandbox warning step, support KYB/KYC skip with resume logic
- `src/components/billing/PlanTab.tsx` — Add resume upgrade banner when KYB/KYC done but still Lite
- `src/app/api/webhooks/stripe/route.ts` — Call `wipeTestEnterprise()` in `handleCheckoutCompleted()` for Lite→paid upgrades

---

## Task 1: Shared Seed Helpers

**Files:**
- Create: `src/lib/test-mode/seed/helpers.ts`

- [ ] **Step 1: Create the helpers module**

```typescript
// src/lib/test-mode/seed/helpers.ts

/** Days ago from now as ISO string */
export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

/** Days from now as ISO string */
export function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

/** Days from now as YYYY-MM-DD */
export function dateDaysFromNow(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().split('T')[0];
}

/** Days ago as YYYY-MM-DD */
export function dateDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0];
}

/** Random float between min and max */
export function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/** Random integer between min and max (inclusive) */
export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/** Generate a fake Ethereum tx hash */
export function ethHash(): string {
  const chars = '0123456789abcdef';
  let hash = '0x';
  for (let i = 0; i < 64; i++) hash += chars[Math.floor(Math.random() * 16)];
  return hash;
}

/** Generate a fake Solana tx hash */
export function solHash(): string {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let hash = '';
  for (let i = 0; i < 88; i++) hash += chars[Math.floor(Math.random() * chars.length)];
  return hash;
}

/** Pick a random element from an array */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Supabase admin client type shorthand */
export type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>;

/** Common params for all seed modules */
export interface SeedContext {
  supabase: SupabaseAdmin;
  enterpriseId: string;
  userId: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/helpers.ts
git commit -m "feat: add shared helpers for test mode seed modules"
```

---

## Task 2: Seed Wallets Module

**Files:**
- Create: `src/lib/test-mode/seed/wallets.ts`

- [ ] **Step 1: Create wallets seed module**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/wallets.ts
git commit -m "feat: add wallets seed module with balances and 180-day snapshots"
```

---

## Task 3: Seed Banking Module

**Files:**
- Create: `src/lib/test-mode/seed/banking.ts`

- [ ] **Step 1: Create banking seed module**

```typescript
// src/lib/test-mode/seed/banking.ts
import { SeedContext, daysAgo, rand, pick } from './helpers';

const TEST_BANKS = [
  { institution: 'JPMorgan Chase', name: 'Primary Operating', last4: '4521', currency: 'USD', balance: '450000.00' },
  { institution: 'Silicon Valley Bank', name: 'Reserves', last4: '7832', currency: 'USD', balance: '1200000.00' },
  { institution: 'Mercury', name: 'Startup Ops', last4: '1290', currency: 'USD', balance: '85000.00' },
  { institution: 'Barclays', name: 'EUR Operations', last4: '6614', currency: 'EUR', balance: '320000.00' },
  { institution: 'HSBC', name: 'GBP Account', last4: '5507', currency: 'GBP', balance: '175000.00' },
  { institution: 'Deutsche Bank', name: 'EU Reserves', last4: '3341', currency: 'EUR', balance: '500000.00' },
];

export interface BankIds {
  bankAccountIds: string[];
}

export async function seedBanking(ctx: SeedContext): Promise<BankIds> {
  const { supabase, enterpriseId, userId } = ctx;
  const now = new Date().toISOString();

  const bankRows = TEST_BANKS.map(b => ({
    user_id: userId,
    enterprise_id: enterpriseId,
    institution_name: b.institution,
    account_name: b.name,
    account_type: 'checking',
    last4: b.last4,
    currency: b.currency,
    current_balance: b.balance,
    balance_currency: b.currency,
    balance_as_of: now,
    is_active: true,
    verified_at: now,
  }));

  const { data: banks } = await supabase
    .from('bank_accounts')
    .insert(bankRows)
    .select('id, institution_name, currency');

  if (!banks?.length) return { bankAccountIds: [] };

  // Seed 20 fiat transactions over 90 days
  const usdBanks = banks.filter(b => b.currency === 'USD');
  const fiatTxns: any[] = [];
  const statuses = ['completed', 'completed', 'completed', 'completed', 'pending', 'failed'];

  for (let i = 0; i < 20; i++) {
    const isOnramp = Math.random() > 0.4;
    const bank = pick(usdBanks.length ? usdBanks : banks);
    const amount = rand(50000, 500000).toFixed(2);
    const feeRate = rand(0.0008, 0.0015);
    const fee = (parseFloat(amount) * feeRate).toFixed(2);
    const fiatAmount = isOnramp
      ? (parseFloat(amount) + parseFloat(fee)).toFixed(2)
      : (parseFloat(amount) - parseFloat(fee)).toFixed(2);

    fiatTxns.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      bank_account_id: bank.id,
      direction: isOnramp ? 'onramp' : 'offramp',
      crypto_token: pick(['USDC', 'USDT']),
      crypto_amount: amount,
      fiat_amount: fiatAmount,
      fiat_currency: 'USD',
      exchange_rate: isOnramp ? rand(0.998, 1.002).toFixed(6) : rand(0.998, 1.002).toFixed(6),
      fee_amount: fee,
      status: pick(statuses),
      provider: 'bridge_xyz',
      created_at: daysAgo(Math.floor(rand(1, 85))),
    });
  }

  await supabase.from('fiat_transactions').insert(fiatTxns);

  return { bankAccountIds: banks.map(b => b.id) };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/banking.ts
git commit -m "feat: add banking seed module with 6 banks and 20 fiat transactions"
```

---

## Task 4: Seed ERP Module

**Files:**
- Create: `src/lib/test-mode/seed/erp.ts`

- [ ] **Step 1: Create ERP seed module**

```typescript
// src/lib/test-mode/seed/erp.ts
import { SeedContext, daysAgo, dateDaysAgo, dateDaysFromNow, rand, pick, ethHash } from './helpers';

const VENDORS = [
  { extId: 'v-001', name: 'Acme Corporation', email: 'billing@acme.example.com', wallet: '0xTESTvendor1111111111111111111111111111', chain: 'ethereum' },
  { extId: 'v-002', name: 'TechSupply Ltd', email: 'ar@techsupply.example.com', wallet: '0xTESTvendor2222222222222222222222222222', chain: 'ethereum' },
  { extId: 'v-003', name: 'Nexus Digital', email: 'finance@nexus.example.com', wallet: 'TESTvendorSo1111111111111111111111111111', chain: 'solana' },
  { extId: 'v-004', name: 'Apex Software', email: 'invoices@apex.example.com', wallet: '0xTESTvendor3333333333333333333333333333', chain: 'ethereum' },
  { extId: 'v-005', name: 'Global Logistics Co', email: 'ap@globallog.example.com', wallet: '0xTESTvendor4444444444444444444444444444', chain: 'ethereum' },
  { extId: 'v-006', name: 'CloudBase Inc', email: 'billing@cloudbase.example.com', wallet: 'TESTvendorSo2222222222222222222222222222', chain: 'solana' },
  { extId: 'v-007', name: 'SecureNet Solutions', email: 'ar@securenet.example.com', wallet: '0xTESTvendor5555555555555555555555555555', chain: 'ethereum' },
  { extId: 'v-008', name: 'DataFlow Analytics', email: 'billing@dataflow.example.com', wallet: '0xTESTvendor6666666666666666666666666666', chain: 'ethereum' },
  { extId: 'v-009', name: 'Prime Consulting', email: 'invoices@prime.example.com', wallet: '0xTESTvendor7777777777777777777777777777', chain: 'ethereum' },
  { extId: 'v-010', name: 'Greenfield Energy', email: 'finance@greenfield.example.com', wallet: 'TESTvendorSo3333333333333333333333333333', chain: 'solana' },
  { extId: 'v-011', name: 'Urban Property Mgmt', email: 'billing@urbanprop.example.com', wallet: '0xTESTvendor8888888888888888888888888888', chain: 'ethereum' },
  { extId: 'v-012', name: 'Legal Eagles LLP', email: 'invoicing@legaleagles.example.com', wallet: '0xTESTvendor9999999999999999999999999999', chain: 'ethereum' },
];

export interface ErpIds {
  erpConfigIds: string[];
  vendorIds: string[];
  invoiceIds: string[];
}

export async function seedErp(ctx: SeedContext): Promise<ErpIds> {
  const { supabase, enterpriseId, userId } = ctx;
  const now = new Date().toISOString();

  const erpCreds = Buffer.from(JSON.stringify({
    apiKey: 'test-erp-key-000',
    baseUrl: 'https://test-erp.example.com',
  })).toString('base64');

  // Insert 2 ERP configs
  const { data: erps } = await supabase
    .from('erp_configurations')
    .insert([
      { user_id: userId, enterprise_id: enterpriseId, provider: 'sap', label: 'SAP S/4HANA', credentials: erpCreds, is_active: true, last_synced: now },
      { user_id: userId, enterprise_id: enterpriseId, provider: 'oracle', label: 'Oracle NetSuite', credentials: erpCreds, is_active: true, last_synced: now },
    ])
    .select('id, provider');

  if (!erps?.length) return { erpConfigIds: [], vendorIds: [], invoiceIds: [] };

  const sapId = erps.find(e => e.provider === 'sap')!.id;
  const oracleId = erps.find(e => e.provider === 'oracle')!.id;

  // Insert vendors — split between SAP (first 7) and Oracle (last 5)
  const vendorRows = VENDORS.map((v, i) => ({
    erp_config_id: i < 7 ? sapId : oracleId,
    enterprise_id: enterpriseId,
    external_id: v.extId,
    name: v.name,
    email: v.email,
    wallet_address: v.wallet,
    chain: v.chain,
    synced_at: now,
  }));

  const { data: vendors } = await supabase
    .from('erp_vendors')
    .insert(vendorRows)
    .select('id, external_id, erp_config_id');

  if (!vendors?.length) return { erpConfigIds: erps.map(e => e.id), vendorIds: [], invoiceIds: [] };

  // Generate 18 invoices across 90-day span
  const invoiceStatuses = ['paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'paid', 'unpaid', 'unpaid', 'unpaid', 'overdue', 'overdue', 'overdue'];
  const descriptions = ['Monthly hosting', 'Software licenses', 'Cloud infrastructure', 'Consulting Q1', 'Security audit', 'Office supplies', 'Legal retainer', 'Marketing services', 'Data analytics', 'Equipment lease', 'Insurance premium', 'Maintenance contract', 'Development sprint', 'API usage', 'Support contract', 'Bandwidth upgrade', 'Storage expansion', 'Training program'];

  const invoiceRows = invoiceStatuses.map((status, i) => {
    const vendor = vendors[i % vendors.length];
    const amount = rand(2000, 120000).toFixed(2);
    let dueDate: string;
    let paidAt: string | null = null;

    if (status === 'paid') {
      const ago = Math.floor(rand(7, 85));
      dueDate = dateDaysAgo(ago);
      paidAt = daysAgo(ago - Math.floor(rand(0, 3)));
    } else if (status === 'overdue') {
      dueDate = dateDaysAgo(Math.floor(rand(2, 18)));
    } else {
      dueDate = dateDaysFromNow(Math.floor(rand(3, 30)));
    }

    return {
      user_id: userId,
      enterprise_id: enterpriseId,
      erp_config_id: vendor.erp_config_id,
      erp_invoice_id: `INV-TEST-${String(i + 1).padStart(3, '0')}`,
      vendor_id: vendor.id,
      invoice_number: `INV-TEST-${String(i + 1).padStart(3, '0')}`,
      description: descriptions[i],
      amount,
      token: pick(['USDC', 'USDT']),
      chain: pick(['ethereum', 'solana']),
      due_date: dueDate,
      status,
      paid_at: paidAt,
    };
  });

  const { data: invoices } = await supabase
    .from('invoices')
    .insert(invoiceRows)
    .select('id, erp_config_id, amount, token, status');

  // GL postings for paid invoices
  const paidInvoices = invoices?.filter(inv => inv.status === 'paid') || [];
  if (paidInvoices.length) {
    const glRows = paidInvoices.map(inv => ({
      user_id: userId,
      enterprise_id: enterpriseId,
      erp_config_id: inv.erp_config_id,
      invoice_id: inv.id,
      external_gl_id: `GL-TEST-${inv.id.slice(0, 8)}`,
      amount: inv.amount,
      token: inv.token,
      gl_account: pick(['2000-AP', '5000-OPEX', '6000-SGA', '7000-COGS']),
      posted_at: daysAgo(Math.floor(rand(5, 80))),
      status: 'posted',
    }));

    await supabase.from('gl_postings').insert(glRows);
  }

  return {
    erpConfigIds: erps.map(e => e.id),
    vendorIds: vendors.map(v => v.id),
    invoiceIds: invoices?.map(inv => inv.id) || [],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/erp.ts
git commit -m "feat: add ERP seed module with 12 vendors, 18 invoices, and GL postings"
```

---

## Task 5: Seed Transactions Module

**Files:**
- Create: `src/lib/test-mode/seed/transactions.ts`

- [ ] **Step 1: Create transactions seed module**

```typescript
// src/lib/test-mode/seed/transactions.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

export interface TransactionIds {
  transactionIds: string[];
  paymentIds: string[];
}

export async function seedTransactions(ctx: SeedContext, walletIds: WalletIds, invoiceIds: string[]): Promise<TransactionIds> {
  const { supabase, enterpriseId, userId } = ctx;

  // Generate ~35 on-chain transactions over 90 days
  const txnRows: any[] = [];
  for (let d = 90; d >= 1; d--) {
    if (Math.random() > 0.4) continue; // ~60% chance of tx on any day
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
        from_address: isOutbound ? wallet.address : `0xEXT${ethHash().slice(4)}`,
        to_address: isOutbound ? `0xEXT${ethHash().slice(4)}` : wallet.address,
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

  // Generate payments — some linked to invoices, some ad-hoc
  const paymentRows: any[] = [];

  // Invoice-linked payments (for first 12 paid invoices)
  const paidInvoiceIds = invoiceIds.slice(0, 12);
  for (const invoiceId of paidInvoiceIds) {
    const wallet = pick([...walletIds.ethWallets, ...walletIds.solWallets]);
    const isEth = walletIds.ethWallets.some(w => w.id === wallet.id);
    paymentRows.push({
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

  // 15 ad-hoc completed payments
  for (let i = 0; i < 15; i++) {
    const wallet = pick([...walletIds.ethWallets, ...walletIds.solWallets]);
    const isEth = walletIds.ethWallets.some(w => w.id === wallet.id);
    paymentRows.push({
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

  // 5 scheduled future payments
  for (let i = 0; i < 5; i++) {
    const wallet = pick(walletIds.ethWallets);
    paymentRows.push({
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

  const { data: payments } = await supabase
    .from('payments')
    .insert(paymentRows)
    .select('id, status');

  // Payment attempts for failed payments
  const failedPayments = payments?.filter(p => p.status === 'failed') || [];
  if (failedPayments.length) {
    const attemptRows = failedPayments.flatMap(p => [
      { payment_id: p.id, attempt_no: 1, status: 'failed', error: 'Insufficient gas', attempted_at: daysAgo(randInt(2, 10)) },
      { payment_id: p.id, attempt_no: 2, status: 'failed', error: 'Nonce too low', attempted_at: daysAgo(randInt(1, 5)) },
    ]);
    await supabase.from('payment_attempts').insert(attemptRows);
  }

  return {
    transactionIds: txns?.map(t => t.id) || [],
    paymentIds: payments?.map(p => p.id) || [],
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/transactions.ts
git commit -m "feat: add transactions seed module with 35+ txns, 32 payments, and attempts"
```

---

## Task 6: Seed Swaps Module

**Files:**
- Create: `src/lib/test-mode/seed/swaps.ts`

- [ ] **Step 1: Create swaps seed module**

```typescript
// src/lib/test-mode/seed/swaps.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

export async function seedSwaps(ctx: SeedContext, walletIds: WalletIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/swaps.ts
git commit -m "feat: add swaps seed module with 10 USDC/USDT swap records"
```

---

## Task 7: Seed Bridges Module

**Files:**
- Create: `src/lib/test-mode/seed/bridges.ts`

- [ ] **Step 1: Create bridges seed module**

```typescript
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

  await supabase.from('bridge_transfers').insert(bridgeRows);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/bridges.ts
git commit -m "feat: add bridges seed module with 6 cross-chain bridge transfers"
```

---

## Task 8: Seed Treasury Module

**Files:**
- Create: `src/lib/test-mode/seed/treasury.ts`

- [ ] **Step 1: Create treasury seed module**

```typescript
// src/lib/test-mode/seed/treasury.ts
import { SeedContext, daysAgo, daysFromNow, dateDaysFromNow, rand, randInt, pick } from './helpers';

export async function seedTreasury(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  // Treasury rule
  await supabase.from('treasury_rules').insert({
    user_id: userId,
    enterprise_id: enterpriseId,
    label: 'Primary Safety Rule',
    is_active: true,
    safety_buffer_multiplier: '1.5',
    obligation_lookahead_days: 30,
    approval_threshold_usd: '100000',
    target_stablecoin: 'USDC',
    target_chain: 'ethereum',
  });

  // Manual obligations — monthly, biweekly, one-time across 90-day window
  const obligations: any[] = [];

  // Monthly recurring (5 types × 3 months = 15)
  const monthlyItems = [
    { label: 'AWS Infrastructure', amount: '15000', category: 'vendor' },
    { label: 'Office Lease', amount: '25000', category: 'rent' },
    { label: 'Data Center Colocation', amount: '8500', category: 'vendor' },
    { label: 'Cyber Insurance Premium', amount: '12000', category: 'insurance' },
    { label: 'SaaS Subscriptions', amount: '7200', category: 'vendor' },
  ];
  for (const item of monthlyItems) {
    for (let m = 0; m < 3; m++) {
      obligations.push({
        user_id: userId,
        enterprise_id: enterpriseId,
        label: item.label,
        amount_usd: item.amount,
        due_date: dateDaysFromNow(m * 30 + randInt(1, 5)),
        recurrence: 'monthly',
        category: item.category,
        is_active: true,
      });
    }
  }

  // Biweekly payroll (6 instances)
  for (let i = 0; i < 6; i++) {
    obligations.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      label: 'Biweekly Payroll',
      amount_usd: '180000',
      due_date: dateDaysFromNow(i * 14 + randInt(0, 2)),
      recurrence: 'biweekly',
      category: 'payroll',
      is_active: true,
    });
  }

  // One-time obligations (5)
  const oneTimeItems = [
    { label: 'Annual Audit Fee', amount: '45000' },
    { label: 'Conference Sponsorship', amount: '28000' },
    { label: 'Hardware Refresh', amount: '67000' },
    { label: 'Regulatory Filing', amount: '15000' },
    { label: 'Office Renovation', amount: '120000' },
  ];
  for (let i = 0; i < oneTimeItems.length; i++) {
    obligations.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      label: oneTimeItems[i].label,
      amount_usd: oneTimeItems[i].amount,
      due_date: dateDaysFromNow(randInt(15, 82)),
      is_active: true,
    });
  }

  await supabase.from('manual_obligations').insert(obligations);

  // AI recommendations (5 with various statuses)
  const recommendations = [
    {
      user_id: userId,
      enterprise_id: enterpriseId,
      total_bank_balance_usd: '1735000',
      total_crypto_balance_usd: '2150000',
      obligations_in_window_usd: '895000',
      safety_buffer_target_usd: '1342500',
      obligation_lookahead_days: 30,
      action: 'onramp',
      recommended_amount_usd: '500000',
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Projected obligations of $895K in the next 30 days require maintaining a safety buffer of $1.34M (1.5x multiplier). Current crypto balance of $2.15M provides adequate coverage, but an onramp of $500K from bank reserves would optimize the buffer for upcoming payroll cycles.',
      ai_model: 'claude-sonnet-4-6',
      status: 'executed',
      executed_at: daysAgo(56),
      created_at: daysAgo(57),
    },
    {
      user_id: userId,
      enterprise_id: enterpriseId,
      total_bank_balance_usd: '2235000',
      total_crypto_balance_usd: '2650000',
      obligations_in_window_usd: '420000',
      safety_buffer_target_usd: '630000',
      obligation_lookahead_days: 30,
      action: 'offramp',
      recommended_amount_usd: '200000',
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Crypto holdings exceed the safety buffer target by $2.02M. Recommend offramping $200K to bank accounts to reduce on-chain exposure while maintaining comfortable coverage.',
      ai_model: 'claude-sonnet-4-6',
      status: 'executed',
      executed_at: daysAgo(21),
      created_at: daysAgo(22),
    },
    {
      user_id: userId,
      enterprise_id: enterpriseId,
      total_bank_balance_usd: '2035000',
      total_crypto_balance_usd: '2450000',
      obligations_in_window_usd: '380000',
      safety_buffer_target_usd: '570000',
      obligation_lookahead_days: 30,
      action: 'no_action',
      recommended_amount_usd: '0',
      ai_reasoning: 'Current balances are well-positioned. The safety buffer is maintained at 4.3x the target. No rebalancing needed at this time.',
      ai_model: 'claude-sonnet-4-6',
      status: 'executed',
      created_at: daysAgo(7),
    },
    {
      user_id: userId,
      enterprise_id: enterpriseId,
      total_bank_balance_usd: '1835000',
      total_crypto_balance_usd: '2250000',
      obligations_in_window_usd: '920000',
      safety_buffer_target_usd: '1380000',
      obligation_lookahead_days: 30,
      action: 'onramp',
      recommended_amount_usd: '350000',
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Upcoming payroll cycle and annual audit fee require $920K in the next 30 days. An onramp of $350K will maintain the 1.5x safety buffer through the high-obligation period.',
      ai_model: 'claude-sonnet-4-6',
      status: 'pending_approval',
      requires_approval: true,
      created_at: daysAgo(1),
    },
    {
      user_id: userId,
      enterprise_id: enterpriseId,
      total_bank_balance_usd: '2135000',
      total_crypto_balance_usd: '2450000',
      obligations_in_window_usd: '650000',
      safety_buffer_target_usd: '975000',
      obligation_lookahead_days: 30,
      action: 'offramp',
      recommended_amount_usd: '150000',
      stablecoin_token: 'USDC',
      stablecoin_chain: 'ethereum',
      ai_reasoning: 'Moderate obligation window. Suggest offramping $150K to optimize bank-to-crypto ratio and reduce smart contract risk exposure.',
      ai_model: 'claude-sonnet-4-6',
      status: 'rejected',
      rejected_at: daysAgo(28),
      rejection_reason: 'Prefer to maintain higher on-chain liquidity for upcoming vendor payments',
      created_at: daysAgo(30),
    },
  ];

  await supabase.from('ai_recommendations').insert(recommendations);

  // Treasury forecast (90-day projection)
  const forecastData: any[] = [];
  let runningBalance = 2150000;
  for (let d = 0; d < 90; d++) {
    const dailyChange = rand(-30000, 25000);
    runningBalance += dailyChange;
    forecastData.push({
      day: d,
      date: dateDaysFromNow(d),
      projected_balance: Math.round(runningBalance),
      obligations_due: d % 14 === 0 ? 180000 : d % 30 < 5 ? rand(5000, 25000) : 0,
    });
  }

  await supabase.from('treasury_forecasts').insert({
    user_id: userId,
    enterprise_id: enterpriseId,
    lookahead_days: 90,
    forecast_data: forecastData,
    ai_summary: 'Projected cash flow remains healthy over the 90-day window. Key pressure points: biweekly payroll cycles and the annual audit fee due in ~45 days. Recommend maintaining current onramp cadence. Risk level: LOW.',
    generated_at: new Date().toISOString(),
  });

  // Simulation run
  await supabase.from('simulation_runs').insert({
    user_id: userId,
    enterprise_id: enterpriseId,
    rule_snapshot: {
      safety_buffer_multiplier: 1.5,
      obligation_lookahead_days: 30,
      target_stablecoin: 'USDC',
      target_chain: 'ethereum',
      approval_threshold_usd: 100000,
    },
    results: [
      { scenario: 'base', end_balance: 2450000, min_balance: 1900000, shortfall_days: 0 },
      { scenario: 'stress_-20%', end_balance: 1960000, min_balance: 1420000, shortfall_days: 0 },
      { scenario: 'stress_-40%', end_balance: 1470000, min_balance: 940000, shortfall_days: 3 },
    ],
    summary: {
      total_scenarios: 3,
      scenarios_with_shortfall: 1,
      worst_case_min_balance: 940000,
      recommendation: 'Current treasury position is resilient under moderate stress. Consider increasing buffer if 40% drawdown scenario is a concern.',
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/treasury.ts
git commit -m "feat: add treasury seed module with rules, obligations, AI recs, forecasts"
```

---

## Task 9: Seed Yield Module

**Files:**
- Create: `src/lib/test-mode/seed/yield.ts`

- [ ] **Step 1: Create yield seed module**

```typescript
// src/lib/test-mode/seed/yield.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash, solHash } from './helpers';
import type { WalletIds } from './wallets';

export async function seedYield(ctx: SeedContext, walletIds: WalletIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const positions = [
    { protocol: 'aave_v3', chain: 'ethereum', token: 'USDC', yieldToken: 'aUSDC', deposited: 250000, apy: 4.8, wallets: walletIds.ethWallets },
    { protocol: 'morpho', chain: 'ethereum', token: 'USDT', yieldToken: 'mUSDT', deposited: 150000, apy: 5.2, wallets: walletIds.ethWallets },
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
        user_id: userId,
        enterprise_id: enterpriseId,
        wallet_id: wallet.id,
        protocol: pos.protocol,
        chain: pos.chain,
        underlying_token: pos.token,
        yield_token: pos.yieldToken,
        deposited_amount: pos.deposited.toFixed(2),
        current_value_usd: currentValue,
        accrued_yield_usd: accrued,
        apy_snapshot: pos.apy,
        last_refreshed_at: new Date().toISOString(),
        is_active: true,
        metadata: { mock: true },
        created_at: daysAgo(daysActive),
      })
      .select('id')
      .single();

    if (!position) continue;

    // Deposit transaction
    const isEth = pos.chain === 'ethereum';
    await supabase.from('yield_transactions').insert({
      user_id: userId,
      enterprise_id: enterpriseId,
      position_id: position.id,
      protocol: pos.protocol,
      chain: pos.chain,
      tx_type: 'deposit',
      underlying_token: pos.token,
      amount: pos.deposited.toFixed(2),
      amount_usd: pos.deposited.toFixed(2),
      tx_hash: isEth ? ethHash() : solHash(),
      status: 'completed',
      executed_at: daysAgo(daysActive),
      created_at: daysAgo(daysActive),
    });

    // Some positions have partial withdrawals
    if (Math.random() > 0.5) {
      const withdrawAmount = rand(10000, pos.deposited * 0.3).toFixed(2);
      await supabase.from('yield_transactions').insert({
        user_id: userId,
        enterprise_id: enterpriseId,
        position_id: position.id,
        protocol: pos.protocol,
        chain: pos.chain,
        tx_type: 'withdraw',
        underlying_token: pos.token,
        amount: withdrawAmount,
        amount_usd: withdrawAmount,
        tx_hash: isEth ? ethHash() : solHash(),
        status: 'completed',
        executed_at: daysAgo(randInt(5, daysActive - 5)),
        created_at: daysAgo(randInt(5, daysActive - 5)),
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/yield.ts
git commit -m "feat: add yield seed module with 4 protocol positions and transactions"
```

---

## Task 10: Seed Compliance Module

**Files:**
- Create: `src/lib/test-mode/seed/compliance.ts`

- [ ] **Step 1: Create compliance seed module**

```typescript
// src/lib/test-mode/seed/compliance.ts
import { SeedContext, daysAgo, rand, randInt, pick, ethHash } from './helpers';
import type { WalletIds } from './wallets';
import type { TransactionIds } from './transactions';

export async function seedCompliance(ctx: SeedContext, walletIds: WalletIds, txIds: TransactionIds): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  // Sanctions screenings (12 — mix of results)
  const allAddresses = [
    ...walletIds.ethWallets.map(w => ({ address: w.address, chain: 'ethereum' })),
    ...walletIds.solWallets.map(w => ({ address: w.address, chain: 'solana' })),
    { address: '0xEXTsuspect1111111111111111111111111111', chain: 'ethereum' },
    { address: '0xEXTclean2222222222222222222222222222222', chain: 'ethereum' },
    { address: '0xEXTpartial333333333333333333333333333', chain: 'ethereum' },
    { address: 'EXTso1cleanAddr111111111111111111111111111', chain: 'solana' },
  ];

  const screeningRows = allAddresses.map((addr, i) => {
    let result: string;
    let riskScore: number;
    let matchDetails = null;

    if (i < 5) {
      result = 'clear'; riskScore = rand(0, 5);
    } else if (i === allAddresses.length - 3) {
      result = 'sanctioned'; riskScore = 95;
      matchDetails = { matched_list: 'OFAC SDN', matched_entity: 'Test Sanctioned Entity', confidence: 0.98 };
    } else if (i === allAddresses.length - 1) {
      result = 'partial_match'; riskScore = rand(35, 65);
      matchDetails = { matched_list: 'EU Sanctions', matched_entity: 'Similar Name Corp', confidence: 0.42 };
    } else {
      result = 'clear'; riskScore = rand(0, 15);
    }

    return {
      user_id: userId,
      enterprise_id: enterpriseId,
      address: addr.address,
      chain: addr.chain,
      result,
      risk_score: riskScore,
      match_details: matchDetails,
      provider: 'chainalysis',
      screened_at: daysAgo(randInt(0, 60)),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  });

  await supabase.from('sanctions_screenings').insert(screeningRows);

  // KYT transfers (12 — sent and received)
  const kytRows: any[] = [];
  for (let i = 0; i < 12; i++) {
    const isSent = Math.random() > 0.4;
    const isEth = Math.random() > 0.35;
    const wallet = isEth ? pick(walletIds.ethWallets) : pick(walletIds.solWallets);
    const riskScore = i < 8 ? rand(0.1, 15) : rand(25, 75);
    const categories = ['exchange', 'defi', 'unknown', 'mining', 'gambling', 'mixer'];
    const txId = txIds.transactionIds.length > i ? txIds.transactionIds[i] : null;

    kytRows.push({
      user_id: userId,
      enterprise_id: enterpriseId,
      external_id: `kyt-test-${String(i + 1).padStart(3, '0')}`,
      chain: isEth ? 'ethereum' : 'solana',
      direction: isSent ? 'sent' : 'received',
      tx_hash: ethHash(),
      from_address: isSent ? wallet.address : `0xEXT${ethHash().slice(4)}`,
      to_address: isSent ? `0xEXT${ethHash().slice(4)}` : wallet.address,
      token: pick(['USDC', 'USDT']),
      amount: rand(5000, 200000).toFixed(2),
      asset_amount_usd: rand(5000, 200000).toFixed(2),
      risk_score: parseFloat(riskScore.toFixed(1)),
      cluster_name: riskScore > 20 ? pick(['Suspicious Exchange', 'High Risk Pool']) : pick(['Coinbase', 'Uniswap V3', 'Circle', 'Binance']),
      cluster_category: riskScore > 20 ? pick(['gambling', 'mixer', 'unknown']) : pick(categories.slice(0, 4)),
      transaction_id: txId,
      registered_at: daysAgo(randInt(1, 80)),
    });
  }

  const { data: kytTransfers } = await supabase
    .from('kyt_transfers')
    .insert(kytRows)
    .select('id, risk_score');

  // KYT alerts for high-risk transfers
  const highRiskTransfers = kytTransfers?.filter(t => t.risk_score > 20) || [];
  const alertStatuses = ['open', 'under_review', 'escalated', 'resolved', 'dismissed'];
  const alertRows = highRiskTransfers.map((t, i) => ({
    user_id: userId,
    enterprise_id: enterpriseId,
    kyt_transfer_id: t.id,
    external_alert_id: `alert-test-${String(i + 1).padStart(3, '0')}`,
    severity: t.risk_score > 60 ? 'severe' : t.risk_score > 40 ? 'high' : 'medium',
    status: alertStatuses[i % alertStatuses.length],
    category: 'suspicious_activity',
    description: t.risk_score > 60
      ? 'Transfer involves address associated with known mixer service'
      : 'Transfer counterparty flagged for unusual activity patterns',
    reviewed_by: i % 3 === 0 ? userId : null,
    reviewed_at: i % 3 === 0 ? daysAgo(randInt(0, 5)) : null,
    review_notes: i % 3 === 0 ? 'Reviewed — counterparty is a known OTC desk, false positive' : null,
  }));

  if (alertRows.length) {
    await supabase.from('kyt_alerts').insert(alertRows);
  }

  // Travel rule transfers (6 — mix of directions and statuses)
  const travelRuleStatuses = ['accepted', 'sent', 'received', 'rejected', 'pending', 'accepted'];
  const travelRuleRows = travelRuleStatuses.map((status, i) => {
    const isOutgoing = i % 2 === 0;
    const paymentId = txIds.paymentIds.length > i ? txIds.paymentIds[i] : null;

    return {
      user_id: userId,
      enterprise_id: enterpriseId,
      payment_id: paymentId,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      amount_usd: rand(15000, 300000).toFixed(2),
      originator_name: isOutgoing ? 'Test Enterprise LLC' : `External Corp ${i}`,
      originator_address: isOutgoing ? '123 Test St, New York, NY' : `${randInt(1, 999)} External Ave, London, UK`,
      originator_wallet: isOutgoing ? pick(walletIds.ethWallets).address : `0xEXT${ethHash().slice(4)}`,
      originator_chain: 'ethereum',
      originator_vasp: isOutgoing ? 'vantor' : pick(['fireblocks', 'circle', 'coinbase']),
      beneficiary_name: isOutgoing ? `Vendor ${i + 1} GmbH` : 'Test Enterprise LLC',
      beneficiary_address: isOutgoing ? `${randInt(1, 999)} Vendor Str, Berlin, DE` : '123 Test St, New York, NY',
      beneficiary_wallet: isOutgoing ? `0xEXT${ethHash().slice(4)}` : pick(walletIds.ethWallets).address,
      beneficiary_chain: 'ethereum',
      beneficiary_vasp: isOutgoing ? pick(['fireblocks', 'circle', 'binance']) : 'vantor',
      status,
      provider_ref: `tr-test-${String(i + 1).padStart(3, '0')}`,
      error_message: status === 'rejected' ? 'Beneficiary VASP rejected — incomplete originator data' : null,
      sent_at: ['sent', 'accepted', 'received'].includes(status) ? daysAgo(randInt(1, 60)) : null,
      received_at: ['accepted', 'received'].includes(status) ? daysAgo(randInt(0, 55)) : null,
    };
  });

  await supabase.from('travel_rule_transfers').insert(travelRuleRows);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/compliance.ts
git commit -m "feat: add compliance seed module with screenings, KYT, alerts, travel rule"
```

---

## Task 11: Seed Audit Module

**Files:**
- Create: `src/lib/test-mode/seed/audit.ts`

- [ ] **Step 1: Create audit seed module**

```typescript
// src/lib/test-mode/seed/audit.ts
import { SeedContext, daysAgo, randInt, pick } from './helpers';

export async function seedAudit(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const actions = [
    { action: 'login', entity_type: 'session', details: { method: 'credentials' } },
    { action: 'wallet_connect', entity_type: 'wallet', details: { chain: 'ethereum', label: 'Treasury Main' } },
    { action: 'wallet_connect', entity_type: 'wallet', details: { chain: 'solana', label: 'Solana Treasury' } },
    { action: 'payment_create', entity_type: 'payment', details: { amount: '45000', token: 'USDC' } },
    { action: 'payment_approve', entity_type: 'payment', details: { amount: '45000', token: 'USDC' } },
    { action: 'payment_execute', entity_type: 'payment', details: { amount: '45000', token: 'USDC', tx_hash: '0xabc...' } },
    { action: 'swap_execute', entity_type: 'swap', details: { from: 'USDT', to: 'USDC', amount: '100000' } },
    { action: 'invoice_sync', entity_type: 'invoice', details: { erp: 'SAP', count: 5 } },
    { action: 'erp_connect', entity_type: 'erp_configuration', details: { provider: 'sap' } },
    { action: 'erp_connect', entity_type: 'erp_configuration', details: { provider: 'oracle' } },
    { action: 'bank_account_connect', entity_type: 'bank_account', details: { institution: 'JPMorgan Chase' } },
    { action: 'onramp_execute', entity_type: 'fiat_transaction', details: { amount: '500000', token: 'USDC' } },
    { action: 'offramp_execute', entity_type: 'fiat_transaction', details: { amount: '200000', token: 'USDC' } },
    { action: 'settings_update', entity_type: 'treasury_rules', details: { field: 'safety_buffer_multiplier', value: '1.5' } },
    { action: 'treasury_recommendation_approve', entity_type: 'ai_recommendation', details: { action: 'onramp', amount: '350000' } },
    { action: 'treasury_recommendation_reject', entity_type: 'ai_recommendation', details: { action: 'offramp', reason: 'Prefer higher on-chain liquidity' } },
    { action: 'bridge_execute', entity_type: 'bridge_transfer', details: { from: 'ethereum', to: 'solana', amount: '100000' } },
    { action: 'login', entity_type: 'session', details: { method: 'credentials' } },
    { action: 'payment_create', entity_type: 'payment', details: { amount: '12000', token: 'USDC' } },
    { action: 'gl_post', entity_type: 'gl_posting', details: { erp: 'SAP', account: '2000-AP' } },
    { action: 'login', entity_type: 'session', details: { method: 'credentials' } },
    { action: 'swap_execute', entity_type: 'swap', details: { from: 'USDC', to: 'USDT', amount: '50000' } },
    { action: 'bank_balance_refresh', entity_type: 'bank_account', details: { count: 6 } },
    { action: 'payment_execute', entity_type: 'payment', details: { amount: '80000', token: 'USDT' } },
    { action: 'invoice_sync', entity_type: 'invoice', details: { erp: 'Oracle', count: 3 } },
  ];

  const auditRows = actions.map((a, i) => ({
    user_id: userId,
    enterprise_id: enterpriseId,
    action: a.action,
    entity_type: a.entity_type,
    details: a.details,
    ip_address: pick(['192.168.1.100', '10.0.0.1', '172.16.0.50', '203.0.113.42']),
    user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    created_at: daysAgo(Math.floor((i / actions.length) * 85) + randInt(0, 2)),
  }));

  await supabase.from('audit_logs').insert(auditRows);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/test-mode/seed/audit.ts
git commit -m "feat: add audit seed module with 25 realistic log entries"
```

---

## Task 12: Seed Orchestrator and Wipe Module

**Files:**
- Create: `src/lib/test-mode/seed/seed-all.ts`
- Create: `src/lib/test-mode/seed/wipe.ts`

- [ ] **Step 1: Create seed-all orchestrator**

```typescript
// src/lib/test-mode/seed/seed-all.ts
import { createAdminClient } from '@/lib/supabase/admin';
import type { SeedContext } from './helpers';
import { seedWallets } from './wallets';
import { seedBanking } from './banking';
import { seedErp } from './erp';
import { seedTransactions } from './transactions';
import { seedSwaps } from './swaps';
import { seedBridges } from './bridges';
import { seedTreasury } from './treasury';
import { seedYield } from './yield';
import { seedCompliance } from './compliance';
import { seedAudit } from './audit';

/**
 * Seeds a test enterprise with comprehensive demo data across all domains.
 * Called during enterprise creation for Lite tier test mode.
 */
export async function seedAll(
  testEnterpriseId: string,
  sourceEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<void> {
  const supabase = adminClient || createAdminClient();

  // Get the primary user from the real enterprise
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('enterprise_id', sourceEnterpriseId)
    .limit(1);

  const userId = users?.[0]?.id;
  if (!userId) return;

  const ctx: SeedContext = { supabase, enterpriseId: testEnterpriseId, userId };

  // Phase 1: No dependencies — run in parallel
  const [walletIds, bankIds, erpIds] = await Promise.all([
    seedWallets(ctx),
    seedBanking(ctx),
    seedErp(ctx),
  ]);

  // Phase 2: Depend on wallets/erp
  const [txIds] = await Promise.all([
    seedTransactions(ctx, walletIds, erpIds.invoiceIds),
    seedSwaps(ctx, walletIds),
    seedBridges(ctx, walletIds),
  ]);

  // Phase 3: Depend on wallets
  await Promise.all([
    seedTreasury(ctx),
    seedYield(ctx, walletIds),
  ]);

  // Phase 4: Depend on wallets + transactions
  await seedCompliance(ctx, walletIds, txIds);

  // Phase 5: Depend on everything
  await seedAudit(ctx);
}
```

- [ ] **Step 2: Create wipe module**

```typescript
// src/lib/test-mode/seed/wipe.ts
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Deletes ALL data for a test enterprise. Used when upgrading from Lite to paid.
 * Deletes in reverse dependency order to respect foreign key constraints.
 * Safety: refuses to wipe non-test enterprises.
 */
export async function wipeTestEnterprise(
  testEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<{ success: boolean; error?: string }> {
  const supabase = adminClient || createAdminClient();

  // Safety check: must be a test enterprise
  const { data: enterprise } = await supabase
    .from('enterprises')
    .select('is_test_enterprise, test_data_wiped_at')
    .eq('id', testEnterpriseId)
    .single();

  if (!enterprise?.is_test_enterprise) {
    return { success: false, error: 'Cannot wipe a non-test enterprise' };
  }

  if (enterprise.test_data_wiped_at) {
    return { success: true }; // Already wiped — idempotent
  }

  // Delete in reverse dependency order
  // Each delete is scoped to enterprise_id
  const tables = [
    'audit_logs',
    'travel_rule_transfers',
    'kyt_alerts',
    'kyt_transfers',
    'sanctions_screenings',
    'yield_transactions',
    'yield_positions',
    'simulation_runs',
    'treasury_forecasts',
    'ai_recommendations',
    'manual_obligations',
    'treasury_rules',
    'bridge_transfers',
    'swaps',
    'payment_attempts', // no enterprise_id — delete via payments
    'payments',
    'transactions',
    'gl_postings',
    'invoices',
    'erp_vendors', // no enterprise_id — delete via erp_configurations
    'erp_configurations',
    'fiat_transactions',
    'bank_accounts',
    'balance_snapshots',
    'wallet_balances',
    'wallets',
  ];

  for (const table of tables) {
    if (table === 'payment_attempts') {
      // payment_attempts FK to payments — delete via subquery
      const { data: payments } = await supabase
        .from('payments')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (payments?.length) {
        await supabase
          .from('payment_attempts')
          .delete()
          .in('payment_id', payments.map(p => p.id));
      }
      continue;
    }

    if (table === 'erp_vendors') {
      // erp_vendors FK to erp_configurations — delete via subquery
      const { data: erps } = await supabase
        .from('erp_configurations')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (erps?.length) {
        await supabase
          .from('erp_vendors')
          .delete()
          .in('erp_config_id', erps.map(e => e.id));
      }
      continue;
    }

    await supabase.from(table).delete().eq('enterprise_id', testEnterpriseId);
  }

  // Mark as wiped
  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: new Date().toISOString() })
    .eq('id', testEnterpriseId);

  return { success: true };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/test-mode/seed/seed-all.ts src/lib/test-mode/seed/wipe.ts
git commit -m "feat: add seed orchestrator and wipe module for test enterprises"
```

---

## Task 13: Database Migration

**Files:**
- Create: `supabase/migrations/0017_test_data_wiped.sql`

- [ ] **Step 1: Create migration**

```sql
-- 0017_test_data_wiped.sql
-- Add test_data_wiped_at to enterprises for tracking when demo data was cleared on upgrade

ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS test_data_wiped_at TIMESTAMPTZ;

COMMENT ON COLUMN enterprises.test_data_wiped_at IS 'Set when Lite demo data is wiped on upgrade to a paid tier';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0017_test_data_wiped.sql
git commit -m "feat: add test_data_wiped_at column to enterprises table"
```

---

## Task 14: Update Test Mode Helpers

**Files:**
- Modify: `src/lib/test-mode/helpers.ts`

- [ ] **Step 1: Replace seedTestData with seedAll import**

Replace the entire `seedTestData` function body and update imports. The `seedTestEnterprise` export stays as a thin wrapper. `ensureTestEnterprise` gains a check for `test_data_wiped_at` so it doesn't re-seed paid-tier sandbox enterprises.

Edit `src/lib/test-mode/helpers.ts` — replace lines 90-412 (the `seedTestData` call and the entire `seedTestData` function) with:

```typescript
  // Seed test data
  await seedAll(testEnt.id, realEnterpriseId);

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
  await seedAll(testEnterpriseId, sourceEnterpriseId, adminClient);
}
```

And add the import at the top of the file:

```typescript
import { seedAll } from './seed/seed-all';
```

- [ ] **Step 2: Update ensureTestEnterprise to check test_data_wiped_at**

In the `ensureTestEnterprise` function, after the existing check for `test_enterprise_id`, add a check that skips seeding if the test enterprise was already wiped (paid sandbox mode):

Change the existing check block (lines 50-58) to also select `test_data_wiped_at` from the test enterprise:

```typescript
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
```

This stays the same — if the test enterprise exists, return its ID regardless. The wipe state is handled by the fact that `seedAll` is only called on creation, not on subsequent access.

- [ ] **Step 3: Commit**

```bash
git add src/lib/test-mode/helpers.ts
git commit -m "refactor: replace inline seedTestData with seedAll from seed modules"
```

---

## Task 15: Update Registration Route

**Files:**
- Modify: `src/app/api/auth/register/route.ts`

- [ ] **Step 1: Update import and call**

In `src/app/api/auth/register/route.ts`, find the import of `seedTestEnterprise` (it may be from `@/lib/test-mode/helpers`). The function signature hasn't changed, so only the internal implementation changed in Task 14. Verify the import path is correct:

```typescript
import { seedTestEnterprise } from '@/lib/test-mode/helpers';
```

No code change needed here — `seedTestEnterprise` is already called and it now delegates to `seedAll` internally.

- [ ] **Step 2: Verify no changes needed and commit if any were made**

Read the file to confirm `seedTestEnterprise` is already called correctly. If the import path is already correct, no commit needed for this task.

---

## Task 16: Sandbox Warning Step Component

**Files:**
- Create: `src/components/billing/SandboxWarningStep.tsx`

- [ ] **Step 1: Create the sandbox warning component**

```typescript
// src/components/billing/SandboxWarningStep.tsx
'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';

interface SandboxWarningStepProps {
  onContinue: () => void;
}

export function SandboxWarningStep({ onContinue }: SandboxWarningStepProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="py-4" style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">
            Your test environment will change
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            When you upgrade, your test mode demo data will be cleared and replaced
            with a clean developer sandbox. You&apos;ll connect your own sandbox wallets,
            bank accounts, and integrations for testing.
          </p>
        </div>
      </div>

      <label className="flex items-start gap-2.5 cursor-pointer mb-5 group">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={e => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border bg-background text-primary focus:ring-primary/30 cursor-pointer"
        />
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          I understand my demo data will be removed
        </span>
      </label>

      <button
        onClick={onContinue}
        disabled={!acknowledged}
        className="w-full px-5 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-[#19595b] hover:bg-[#134849] text-white"
      >
        Continue to Payment
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/billing/SandboxWarningStep.tsx
git commit -m "feat: add SandboxWarningStep component for upgrade flow"
```

---

## Task 17: Update UpgradeFlow with Sandbox Warning Step

**Files:**
- Modify: `src/components/billing/UpgradeFlow.tsx`

- [ ] **Step 1: Add sandbox_warning step type and import**

At the top of the file, update the type and imports:

```typescript
import { SandboxWarningStep } from './SandboxWarningStep';
```

Change the type:
```typescript
type UpgradeStep = 'kyb' | 'kyc' | 'sandbox_warning' | 'checkout';
```

Add to STEP_ICONS and STEP_TITLES:
```typescript
const STEP_ICONS: Record<UpgradeStep, typeof Shield> = {
  kyb: Shield,
  kyc: Shield,
  sandbox_warning: AlertTriangle,
  checkout: CreditCard,
};

const STEP_TITLES: Record<UpgradeStep, string> = {
  kyb: 'Business Verification',
  kyc: 'Identity Verification',
  sandbox_warning: 'Sandbox Notice',
  checkout: 'Payment',
};
```

Also import `AlertTriangle` from lucide-react.

- [ ] **Step 2: Update step resolution logic**

Update the initial step computation (around line 42-44) to include sandbox_warning:

```typescript
  const initialStepRef = useRef<UpgradeStep>(
    !skipKyb ? 'kyb' : !kycDone ? 'kyc' : 'sandbox_warning'
  );
```

Update the step transition handlers (around line 63-64):

```typescript
  const handleKybComplete = () => animateToStep('kyc');
  const handleKycComplete = () => animateToStep('sandbox_warning');
  const handleSandboxAcknowledged = () => animateToStep('checkout');
```

- [ ] **Step 3: Update progress steps array**

Replace the progressSteps computation (around lines 98-103):

```typescript
  const progressSteps = (() => {
    const steps: { key: UpgradeStep; label: string; icon: typeof Shield }[] = [];
    if (!skipKyb) steps.push({ key: 'kyb', label: 'Verify Business', icon: Shield });
    if (!kycDone) steps.push({ key: 'kyc', label: 'Verify Identity', icon: Shield });
    steps.push({ key: 'sandbox_warning', label: 'Sandbox Notice', icon: AlertTriangle });
    steps.push({ key: 'checkout', label: 'Payment', icon: CreditCard });
    return steps;
  })();
```

- [ ] **Step 4: Add sandbox_warning step rendering**

In the content area (around line 192-228), add the sandbox_warning step between kyc and checkout:

```typescript
            {step === 'sandbox_warning' && (
              <div style={{ animation: 'fadeSlideUp 0.4s ease-out both' }}>
                <SandboxWarningStep onContinue={handleSandboxAcknowledged} />
              </div>
            )}
```

- [ ] **Step 5: Remove auto-trigger checkout useEffect**

Remove the useEffect that auto-triggers checkout (lines 89-93), since the sandbox_warning step now sits between KYC and checkout. The checkout step should still auto-trigger, but only when the step is explicitly set to 'checkout'. Keep the useEffect but it already works correctly since `step === 'checkout'` is only true after sandbox acknowledgment.

Actually, the useEffect at lines 89-93 already only fires when `step === 'checkout'`, which is now only reached after the sandbox warning. No change needed.

- [ ] **Step 6: Commit**

```bash
git add src/components/billing/UpgradeFlow.tsx
git commit -m "feat: add sandbox warning step to upgrade flow between KYC and checkout"
```

---

## Task 18: Update PlanTab with Resume Upgrade Banner

**Files:**
- Modify: `src/components/billing/PlanTab.tsx`

- [ ] **Step 1: Add resume banner logic**

After the session/tier setup and before the return, add:

```typescript
  const kybDone = session?.user?.kyb_status === 'completed';
  const kycDone = session?.user?.kyc_status === 'completed';
  const isLite = tier === 'lite';
  const showResumeBanner = isLite && (kybDone || kycDone);

  let resumeMessage = '';
  let resumeCta = '';
  if (kybDone && kycDone) {
    resumeMessage = 'Verification complete — finish your upgrade';
    resumeCta = 'Complete Upgrade';
  } else if (kybDone) {
    resumeMessage = 'Business verification complete — continue with identity verification';
    resumeCta = 'Continue Upgrade';
  }
```

- [ ] **Step 2: Add banner JSX**

In the return, add the banner right after the current plan summary `<div>` and before the tier comparison grid:

```typescript
      {/* Resume upgrade banner */}
      {showResumeBanner && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowRight className="w-4 h-4 text-primary" />
            </div>
            <p className="text-sm text-foreground">{resumeMessage}</p>
          </div>
          <button
            onClick={() => setUpgradeTier('starter')}
            className="px-4 py-2 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors flex-shrink-0"
          >
            {resumeCta}
          </button>
        </div>
      )}
```

Add `ArrowRight` to the lucide-react import.

- [ ] **Step 3: Commit**

```bash
git add src/components/billing/PlanTab.tsx
git commit -m "feat: add resume upgrade banner to PlanTab when KYB/KYC partially done"
```

---

## Task 19: Wipe Test Data on Successful Checkout

**Files:**
- Modify: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Update handleCheckoutCompleted to wipe test data**

Import the wipe function at the top of the file:

```typescript
import { wipeTestEnterprise } from '@/lib/test-mode/seed/wipe';
```

In the `handleCheckoutCompleted` function (currently lines 316-338), add the wipe logic after the subscription update. The `session.metadata` contains `enterprise_id` and `target_tier`:

```typescript
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (!session.subscription || !session.metadata?.enterprise_id) return;
  const supabaseAdmin = createAdminClient();

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription.id;
  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  // Update the subscription record with Stripe IDs
  await supabaseAdmin
    .from('subscriptions')
    .update({
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId || undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('enterprise_id', session.metadata.enterprise_id);

  // Wipe test enterprise demo data on Lite → paid upgrade
  const { data: enterprise } = await supabaseAdmin
    .from('enterprises')
    .select('test_enterprise_id')
    .eq('id', session.metadata.enterprise_id)
    .single();

  if (enterprise?.test_enterprise_id) {
    await wipeTestEnterprise(enterprise.test_enterprise_id, supabaseAdmin);
  }

  // The subscription.created webhook will handle the tier update
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: wipe test enterprise demo data on successful Stripe checkout"
```

---

## Task 20: Update Test Mode Toggle

**Files:**
- Modify: `src/app/api/test-mode/toggle/route.ts`

- [ ] **Step 1: Read the current file**

Read `src/app/api/test-mode/toggle/route.ts` to see the current code.

- [ ] **Step 2: Update ensureTestEnterprise call to skip seeding for wiped enterprises**

The `ensureTestEnterprise` function already returns the existing test enterprise ID without re-seeding. But we should check: if a user on a paid tier toggles test mode, `ensureTestEnterprise` would be called and potentially seed data for a new test enterprise. We need to make sure it doesn't seed if the enterprise already existed and was wiped.

Look at the `ensureTestEnterprise` function — it already returns early if `test_enterprise_id` exists. Since the wipe only deletes data rows, not the enterprise record itself, the enterprise will still exist and be returned. No re-seeding happens.

No code change needed here — the existing flow is correct. The test enterprise record persists through the wipe, so `ensureTestEnterprise` finds it and returns without re-creating.

- [ ] **Step 3: Verify and commit if any changes were made**

If no changes needed, skip this commit.

---

## Task 21: Verify and Test End-to-End

- [ ] **Step 1: Run TypeScript compilation check**

```bash
cd C:/Users/John/crypto-treasury && npx tsc --noEmit
```

Expected: No type errors in the new seed modules.

- [ ] **Step 2: Run the dev server and test**

```bash
cd C:/Users/John/crypto-treasury && npm run dev
```

- [ ] **Step 3: Manual verification checklist**

1. Register a new account → verify test enterprise is created with full demo data
2. Toggle test mode ON → verify all pages show data (dashboard, transactions, yield, compliance, treasury AI, reporting)
3. In Settings > Billing, click Upgrade → verify flow shows KYB → KYC → Sandbox Warning → Checkout steps
4. If KYB is completed, re-open upgrade flow → verify it skips to KYC step
5. If KYB + KYC both done, re-open → verify it goes to Sandbox Warning
6. Verify resume banner appears on PlanTab after partial upgrade flow
7. After successful checkout, verify test mode is wiped clean (empty state in all pages)

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```
