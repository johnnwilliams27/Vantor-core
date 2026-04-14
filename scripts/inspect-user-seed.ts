/* eslint-disable no-console */
/**
 * One-off diagnostic: for a given user email, count rows in every table
 * the seeder touches, scoped to their test_enterprise_id. Also dump any
 * flags that explain gaps (no test_enterprise, no wallet rows, etc).
 *
 * Usage: npx tsx scripts/inspect-user-seed.ts <email>
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

const envFile = process.env.INSPECT_ENV ?? '.env.local';
config({ path: resolve(process.cwd(), envFile) });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const EMAIL = process.argv[2] ?? 'jw3@vantorteam.testinator.email';

// Expected row counts on a fresh seed (from seed-all.ts modules).
const EXPECTED: Record<string, number | string> = {
  wallets: 5,
  wallet_balances: '5+',
  balance_snapshots: '~900 (5 wallets × 180d)',
  bank_accounts: 9,
  fiat_transactions: 25,
  fiat_payments: 25,
  erp_configurations: 2,
  erp_vendors: 14,
  invoices: 18,
  transactions: '~35',
  transfers: 27,
  transfer_attempts: '>=27',
  swaps: 8,
  bridge_transfers: 4,
  treasury_rules: 1,
  obligations: 26,
  ai_recommendations: 4,
  yield_positions: 7,
  yield_transactions: 7,
  sanctions_screenings: 8,
  kyt_alerts: 8,
  kyt_transfers: 12,
  audit_logs: 28,
  policy_policies: 1,
  policy_versions: 3,
  policy_approval_chains: 3,
  policy_hard_limits: 6,
  policy_rules: 3,
  policy_approval_requests: 6,
  treasury_state_snapshots: 1,
  treasury_insights: 8,
  notifications: '>=8',
  // Skipped-on-purpose (append-only):
  policy_evaluations: 'skip (append-only)',
  policy_activation_events: 'skip (append-only)',
};

async function main() {
  console.log(`\n── Inspecting ${EMAIL} ──\n`);

  // 1. User + enterprise
  const { data: user, error: userErr } = await sb
    .from('user_profiles')
    .select('id, email, enterprise_id, role, is_app_admin')
    .eq('email', EMAIL)
    .maybeSingle();
  if (userErr || !user) {
    console.error('user_profiles lookup failed:', userErr?.message ?? 'not found');
    process.exit(1);
  }
  console.log('user:', user);

  const { data: ent, error: entErr } = await sb
    .from('enterprises')
    .select('id, name, test_enterprise_id, is_test_enterprise, subscription_tier')
    .eq('id', user.enterprise_id)
    .maybeSingle();
  if (entErr || !ent) {
    console.error('enterprises lookup failed:', entErr?.message ?? 'not found');
    process.exit(1);
  }
  console.log('real enterprise:', ent);

  const testId: string | null = ent.test_enterprise_id ?? null;
  if (!testId) {
    console.error('\n❌ No test_enterprise_id on this enterprise — seeding cannot target a test scope.');
    process.exit(1);
  }
  const { data: testEnt } = await sb
    .from('enterprises')
    .select('id, name, is_test_enterprise, parent_enterprise_id')
    .eq('id', testId)
    .maybeSingle();
  console.log('test enterprise:', testEnt);

  // 2. Per-table counts, scoped to test enterprise
  console.log('\n── Row counts (test_enterprise_id scope) ──\n');
  const tables = Object.keys(EXPECTED);
  const results: { table: string; actual: number | string; expected: number | string; delta: string }[] = [];

  // These policy tables are scoped by policy_id, not enterprise_id.
  // Need an IN list of policy ids belonging to the test enterprise.
  const { data: pols } = await sb.from('policy_policies').select('id').eq('enterprise_id', testId);
  const policyIds = (pols ?? []).map((p) => p.id);
  const POLICY_SCOPED = new Set(['policy_approval_chains', 'policy_hard_limits', 'policy_rules', 'policy_versions', 'policy_approval_requests']);

  for (const t of tables) {
    if (typeof EXPECTED[t] === 'string' && EXPECTED[t].toString().startsWith('skip')) {
      results.push({ table: t, actual: '—', expected: EXPECTED[t], delta: 'ok (skipped)' });
      continue;
    }
    let q = sb.from(t).select('*', { count: 'exact', head: true });
    if (POLICY_SCOPED.has(t)) {
      if (policyIds.length === 0) { results.push({ table: t, actual: 0, expected: EXPECTED[t], delta: '❌ EMPTY (no policy)' }); continue; }
      q = q.in('policy_id', policyIds);
    } else {
      q = q.eq('enterprise_id', testId);
    }
    const { count, error } = await q;
    if (error) {
      console.error(`[${t}]`, error);
      results.push({ table: t, actual: `ERR:${error.code ?? error.message ?? 'unknown'}`, expected: EXPECTED[t], delta: 'err' });
      continue;
    }
    const actual = count ?? 0;
    const exp = EXPECTED[t];
    let delta = 'ok';
    if (typeof exp === 'number') {
      if (actual === 0 && exp > 0) delta = '❌ EMPTY';
      else if (actual !== exp) delta = `⚠ ${actual} vs ${exp}`;
    } else if (typeof exp === 'string') {
      if (actual === 0) delta = '❌ EMPTY';
    }
    results.push({ table: t, actual, expected: exp, delta });
  }

  const w = (s: string | number, n: number) => String(s).padEnd(n);
  console.log(w('table', 32), w('actual', 12), w('expected', 24), 'delta');
  console.log('-'.repeat(90));
  for (const r of results) {
    console.log(w(r.table, 32), w(r.actual, 12), w(r.expected, 24), r.delta);
  }

  // 3. Missing tables — anything seeded by code but not in EXPECTED?
  console.log('\n── Summary ──');
  const empty = results.filter((r) => r.delta === '❌ EMPTY');
  const drift = results.filter((r) => r.delta.startsWith('⚠'));
  const err = results.filter((r) => r.delta === 'err');
  console.log(`  empty tables:     ${empty.length}  ${empty.map((r) => r.table).join(', ') || '—'}`);
  console.log(`  drifted counts:   ${drift.length}  ${drift.map((r) => r.table).join(', ') || '—'}`);
  console.log(`  query errors:     ${err.length}  ${err.map((r) => r.table).join(', ') || '—'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
