# Test-Enterprise Seed Demo Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new test enterprises (created on signup + on "Reset test data") render non-empty state across `/policy`, `/approvals`, `/analytics`, `/treasury` insights, and the global notifications bell.

**Architecture:** Five new seed modules in `src/lib/test-mode/seed/` following the exact pattern of the existing modules (wallets, banking, erp, etc.). A new Phase 6 in `seed-all.ts` runs them after `seedAudit`. `wipe.ts` gains eight new tables in FK-safe delete order.

**Tech Stack:** TypeScript, Supabase service-role admin client, existing `SeedContext` helper.

**Spec:** `docs/superpowers/specs/2026-04-13-test-seed-demo-data-design.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/lib/test-mode/seed/policy.ts` (new) | Creates 1 policy + 3 versions (v1/v2 superseded, v3 active) with rules/limits/chains. Returns `{ activeVersionId, chainId }` for downstream use. |
| `src/lib/test-mode/seed/approvals.ts` (new) | Creates 6 `policy_approval_requests` (2 pending / 2 approved / 2 denied) referencing the active policy + chain. |
| `src/lib/test-mode/seed/analytics.ts` (new) | Backfills 75 days of `treasury_state_snapshots` + 1 `analytics_pin_preferences` row with 3 pinned view slugs. |
| `src/lib/test-mode/seed/insights.ts` (new) | Inserts 8 hand-crafted `treasury_insights` rows across severity × state × category. |
| `src/lib/test-mode/seed/notifications.ts` (new) | Inserts 10 `notifications` rows across event_type, mix of read/unread. |
| `src/lib/test-mode/seed/seed-all.ts` (modify) | Add Phase 6 block invoking the five new modules. |
| `src/lib/test-mode/seed/wipe.ts` (modify) | Add 7 new tables to the delete list in correct FK order. (`policy_approval_requests` skipped — `_no_delete` rule.) |

**No migrations.** All target tables already exist.

## Schema reference (from migrations — use these exact column names)

**Critical:** the spec used some illustrative field names that don't match the real schema. Use these instead:

- `policy_versions.status` values: **`'draft' | 'active' | 'superseded'`** (NOT `'published'`)
- `policy_versions` uses **`activated_at`** (NOT `published_at`)
- `policy_approval_requests` uses **`resolution_notes` (JSONB)** for notes and **`denial_reason` (TEXT, constrained: `'manual' | 'expired' | 'stale_reeval'`)** for denials. **No `approved_by` column** — approval attribution lives in `slot_assignments` JSONB.
- `policy_rules.rule_type` enum: `'approval_threshold' | 'counterparty' | 'time_window' | 'lookahead'`
- `policy_rules.verdict` enum: `'allow_auto' | 'require_approval' | 'block'`
- `policy_hard_limits.limit_type` enum: `'min_cash_reserve_usd' | 'max_single_asset_concentration_pct' | 'max_daily_outflow_usd' | 'max_30day_outflow_usd' | 'obligation_coverage_days' | 'max_native_exposure'`
- `policy_hard_limits.limit_value` is **TEXT** (string-serialized numeric)
- `treasury_state_snapshots.trigger` enum: `'scheduled' | 'on_demand' | 'pre_decision' | 'pre_action'` — use `'scheduled'`
- `treasury_state_snapshots` requires JSONB `positions` + `fx_rates` + four `total_*_base_usd` NUMERIC columns
- `notifications` columns: `event_type`, `category`, `title`, `body`, `metadata`, `link`, `read` (not `href`, not `is_read`)
- `analytics_pin_preferences` is **one row per (user, enterprise)** with `pinned_slugs TEXT[]` — NOT one row per pin. Saved-view definitions live in `analytics_views` (separate table); we only touch pin preferences + rely on standard views already registered.
- `treasury_insights.state` enum: `'new' | 'viewed' | 'dismissed' | 'acted_on' | 'expired'` (NOT `'acknowledged'`)
- `treasury_insights.insight_type` enum: `'liquidity_below_buffer' | 'liquidity_idle_cash' | 'yield_drop' | 'yield_opportunity' | 'yield_idle_opportunity' | 'concentration_warning' | 'concentration_breach'`

Some DB instances have `treasury_insights.channel` added by an unmerged Phase 0 migration. Write seed rows without `channel` first; if a later TS type error surfaces, add `channel: 'deterministic'` to the insert payloads. Flag this in the final verification task.

---

## Task 1: Create `policy.ts` seed module

**Files:**
- Create: `src/lib/test-mode/seed/policy.ts`

- [ ] **Step 1: Read reference material**

Read `supabase/migrations/0038_policy_engine_schema.sql` (lines 1-160) to confirm column names and CHECK constraints. Read `src/lib/test-mode/seed/treasury.ts` for insert-pattern style.

- [ ] **Step 2: Resolve an admin user id for `created_by`**

The policy tables require `created_by` referencing `user_profiles(id)`. The test enterprise has no users of its own — use the source enterprise's first admin user. Look at how `seed-all.ts` resolves `userId` from `sourceEnterpriseId` and accept it through `ctx.userId` — that's already on `SeedContext`.

- [ ] **Step 3: Write the module**

```ts
// src/lib/test-mode/seed/policy.ts
import type { SeedContext } from './helpers';
import { daysAgo } from './helpers';

export interface PolicyIds {
  policyId: string;
  v1Id: string;
  v2Id: string;
  v3Id: string;      // active
  chainId: string;   // chain on v3, used by approvals seed
}

export async function seedPolicy(ctx: SeedContext): Promise<PolicyIds | null> {
  const { supabase, enterpriseId, userId } = ctx;

  // 1. Create the policy container
  const { data: policy, error: pErr } = await supabase
    .from('policy_policies')
    .insert({ enterprise_id: enterpriseId, name: 'Standard Policy' })
    .select('id')
    .single();
  if (pErr || !policy) { console.error('[seed:policy] policy insert failed', pErr); return null; }

  // 2. Create 3 versions (v1 and v2 get status='superseded'; v3 gets 'active')
  const versionRows = [
    {
      enterprise_id: enterpriseId, version_number: 1, status: 'superseded',
      name: 'Baseline — Lite defaults', created_by: userId, created_at: daysAgo(60),
      activated_at: daysAgo(55), activated_by: userId, superseded_at: daysAgo(30),
    },
    {
      enterprise_id: enterpriseId, version_number: 2, status: 'superseded',
      name: 'Add $2M daily outflow cap', created_by: userId, created_at: daysAgo(35),
      activated_at: daysAgo(30), activated_by: userId, superseded_at: daysAgo(1),
    },
    {
      enterprise_id: enterpriseId, version_number: 3, status: 'active',
      name: 'SoD for >$500K yield deposits', created_by: userId, created_at: daysAgo(2),
      activated_at: daysAgo(1), activated_by: userId,
    },
  ];
  const { data: versions, error: vErr } = await supabase
    .from('policy_versions').insert(versionRows).select('id, version_number');
  if (vErr || !versions || versions.length !== 3) { console.error('[seed:policy] versions failed', vErr); return null; }
  const v1 = versions.find(v => v.version_number === 1)!.id;
  const v2 = versions.find(v => v.version_number === 2)!.id;
  const v3 = versions.find(v => v.version_number === 3)!.id;

  // 3. Link superseded_by chain (v1 → v2 → v3)
  await supabase.from('policy_versions').update({ superseded_by_version_id: v2 }).eq('id', v1);
  await supabase.from('policy_versions').update({ superseded_by_version_id: v3 }).eq('id', v2);

  // 4. Set active pointer on the policy
  await supabase.from('policy_policies').update({ active_version_id: v3 }).eq('id', policy.id);

  // 5. Approval chains — one 2-slot chain per version. v3's id is returned for approvals seed.
  const chainRows = versions.map(v => ({
    version_id: v.id,
    name: 'Standard 2-approver',
    slots: [
      { slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury' },
      { slot_index: 1, minimum_role: 'executive', label: 'Executive' },
    ],
    priority: 0,
    expiration_hours: 48,
    created_by: userId,
  }));
  const { data: chains } = await supabase.from('policy_approval_chains').insert(chainRows).select('id, version_id');
  const v3Chain = chains?.find(c => c.version_id === v3)?.id;
  if (!v3Chain) { console.error('[seed:policy] v3 chain missing'); return null; }

  // 6. Hard limits — v1 has one, v2 adds one, v3 inherits v2's set plus one more
  const v1Limits = [
    { version_id: v1, limit_type: 'min_cash_reserve_usd', name: 'Min cash reserve', limit_value: '100000', limit_currency: 'USD', scope: {}, created_by: userId },
  ];
  const v2Limits = [
    { version_id: v2, limit_type: 'min_cash_reserve_usd', name: 'Min cash reserve', limit_value: '100000', limit_currency: 'USD', scope: {}, created_by: userId },
    { version_id: v2, limit_type: 'max_daily_outflow_usd', name: 'Daily outflow cap', limit_value: '2000000', limit_currency: 'USD', scope: {}, created_by: userId },
  ];
  const v3Limits = [
    { version_id: v3, limit_type: 'min_cash_reserve_usd', name: 'Min cash reserve', limit_value: '100000', limit_currency: 'USD', scope: {}, created_by: userId },
    { version_id: v3, limit_type: 'max_daily_outflow_usd', name: 'Daily outflow cap', limit_value: '2000000', limit_currency: 'USD', scope: {}, created_by: userId },
    { version_id: v3, limit_type: 'max_single_asset_concentration_pct', name: 'Single-asset concentration', limit_value: '60', limit_currency: null, scope: {}, created_by: userId },
  ];
  await supabase.from('policy_hard_limits').insert([...v1Limits, ...v2Limits, ...v3Limits]);

  // 7. Rules — one approval_threshold rule per version pointing at that version's chain
  const chainByVersion: Record<string, string> = {};
  chains?.forEach(c => { chainByVersion[c.version_id] = c.id; });
  const ruleRows = [
    {
      version_id: v1, rule_type: 'approval_threshold', name: '>$50K requires 1 approver',
      rationale: 'Baseline Lite default', priority: 0, verdict: 'require_approval',
      verdict_chain_id: chainByVersion[v1], created_by: userId,
      condition: { op: 'gte', lhs: { kind: 'movement_amount_usd' }, rhs: { kind: 'literal', value: 50000 } },
    },
    {
      version_id: v2, rule_type: 'approval_threshold', name: '>$250K cross-chain requires exec',
      rationale: 'Protect cross-chain moves', priority: 0, verdict: 'require_approval',
      verdict_chain_id: chainByVersion[v2], created_by: userId,
      condition: {
        op: 'and', terms: [
          { op: 'gte', lhs: { kind: 'movement_amount_usd' }, rhs: { kind: 'literal', value: 250000 } },
          { op: 'eq', lhs: { kind: 'movement_kind' }, rhs: { kind: 'literal', value: 'bridge' } },
        ],
      },
    },
    {
      version_id: v3, rule_type: 'approval_threshold', name: '>$500K yield deposit requires SoD',
      rationale: 'Separation of duties on large DeFi deposits', priority: 0, verdict: 'require_approval',
      verdict_chain_id: chainByVersion[v3], created_by: userId,
      condition: {
        op: 'and', terms: [
          { op: 'gte', lhs: { kind: 'movement_amount_usd' }, rhs: { kind: 'literal', value: 500000 } },
          { op: 'eq', lhs: { kind: 'movement_kind' }, rhs: { kind: 'literal', value: 'yield_deposit' } },
        ],
      },
    },
  ];
  await supabase.from('policy_rules').insert(ruleRows);

  console.log('[seed:policy] ✓ 1 policy + 3 versions (v3 active) + chains/limits/rules');
  return { policyId: policy.id, v1Id: v1, v2Id: v2, v3Id: v3, chainId: v3Chain };
}
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/John/crypto-treasury/.worktrees/test-seed-demo-data
git add src/lib/test-mode/seed/policy.ts
git commit -m "feat(test-seed): add policy seed module — 3 versions with v3 active"
```

---

## Task 2: Create `approvals.ts` seed module

**Files:**
- Create: `src/lib/test-mode/seed/approvals.ts`

- [ ] **Step 1: Read reference material**

Read migration 0038 lines 120-160 to confirm `policy_approval_requests` columns + CHECK constraints. Note `status` is constrained to `'pending' | 'approved' | 'executed' | 'denied' | 'escalated' | 'cancelled'`; `denial_reason` constrained to `'manual' | 'expired' | 'stale_reeval'`.

- [ ] **Step 2: Write the module**

```ts
// src/lib/test-mode/seed/approvals.ts
import type { SeedContext } from './helpers';
import { daysAgo, daysFromNow } from './helpers';

export async function seedApprovals(
  ctx: SeedContext,
  v3Id: string,
  chainId: string,
): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const slotShape = (filled: boolean, index: number, role: string, justification?: string) => ({
    slot_index: index,
    minimum_role: role,
    filled_by: filled ? userId : null,
    filled_at: filled ? daysAgo(1) : null,
    justification: filled ? (justification ?? 'Approved in line with policy') : null,
  });

  const rows = [
    // 1. Pending — $750K off-ramp, 1 day old
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-pending-1-${enterpriseId.slice(0, 8)}`,
      proposed_movement: { kind: 'offramp', amount_usd: 750000, asset: 'USDC', chain: 'ethereum', target: 'JPMorgan Operating' },
      triggered_rule_ids: [], slot_assignments: [slotShape(false, 0, 'treasury_manager'), slotShape(false, 1, 'executive')],
      status: 'pending', expires_at: daysFromNow(2), created_by: userId, created_at: daysAgo(1),
    },
    // 2. Pending — $600K yield deposit on Aave, 3 hours old
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-pending-2-${enterpriseId.slice(0, 8)}`,
      proposed_movement: { kind: 'yield_deposit', amount_usd: 600000, asset: 'USDC', chain: 'ethereum', protocol: 'aave_v3' },
      triggered_rule_ids: [], slot_assignments: [slotShape(false, 0, 'treasury_manager'), slotShape(false, 1, 'executive')],
      status: 'pending', expires_at: daysFromNow(2), created_by: userId,
      created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    },
    // 3. Approved — $300K vendor wire, approved 2d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-approved-1-${enterpriseId.slice(0, 8)}`,
      proposed_movement: { kind: 'transfer', amount_usd: 300000, asset: 'USDC', target: 'Q1 audit firm wire' },
      triggered_rule_ids: [], slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Vendor verified'),
        slotShape(true, 1, 'executive', 'Q1 audit — approved per board pre-auth'),
      ],
      status: 'approved', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(2), approved_at: daysAgo(2), resolved_at: daysAgo(2),
      resolution_notes: { note: 'Vendor payment — Q1 audit firm' },
    },
    // 4. Approved — $1.2M intra-wallet rebalance, approved 5d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-approved-2-${enterpriseId.slice(0, 8)}`,
      proposed_movement: { kind: 'transfer', amount_usd: 1200000, asset: 'USDC', target: 'Hot → cold wallet rebalance' },
      triggered_rule_ids: [], slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Rebalance per monthly policy'),
        slotShape(true, 1, 'executive', 'Approved'),
      ],
      status: 'approved', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(5), approved_at: daysAgo(5), resolved_at: daysAgo(5),
      resolution_notes: { note: 'Routine monthly rebalance' },
    },
    // 5. Denied — $450K yield withdraw, denied 1d ago
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-denied-1-${enterpriseId.slice(0, 8)}`,
      proposed_movement: { kind: 'yield_withdraw', amount_usd: 450000, asset: 'USDC', protocol: 'morpho_reservoir' },
      triggered_rule_ids: [], slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Denying — better rates expected'),
        slotShape(false, 1, 'executive'),
      ],
      status: 'denied', denial_reason: 'manual', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(1), resolved_at: daysAgo(1),
      resolution_notes: { note: 'Better rates expected next week per treasury-ai insight' },
    },
    // 6. Denied — $2.1M cross-chain bridge, denied 6d ago (expired chain-wise)
    {
      enterprise_id: enterpriseId, version_id: v3Id, chain_id: chainId,
      movement_id: `seed-approval-denied-2-${enterpriseId.slice(0, 8)}`,
      proposed_movement: { kind: 'bridge', amount_usd: 2100000, asset: 'USDC', from_chain: 'ethereum', to_chain: 'solana' },
      triggered_rule_ids: [], slot_assignments: [
        slotShape(true, 0, 'treasury_manager', 'Exceeds hard limit'),
        slotShape(false, 1, 'executive'),
      ],
      status: 'denied', denial_reason: 'manual', expires_at: daysFromNow(2), created_by: userId,
      created_at: daysAgo(6), resolved_at: daysAgo(6),
      resolution_notes: { note: 'Exceeds daily outflow hard limit ($2M)' },
    },
  ];

  const { error } = await supabase.from('policy_approval_requests').insert(rows);
  if (error) console.error('[seed:approvals] insert failed', error);
  else console.log('[seed:approvals] ✓ 6 approval requests (2 pending, 2 approved, 2 denied)');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/test-mode/seed/approvals.ts
git commit -m "feat(test-seed): add approvals seed — 2 pending, 2 approved, 2 denied"
```

---

## Task 3: Create `analytics.ts` seed module

**Files:**
- Create: `src/lib/test-mode/seed/analytics.ts`

- [ ] **Step 1: Verify pinned slugs**

Read `src/lib/analytics/standard-views.ts` to find 3 actual view slugs registered in code. Pick slugs that render cleanly against the already-seeded data (obligations, transactions, yield positions exist; forecasts do not). Prefer slugs whose name matches "obligation coverage", "stablecoin mix" / "asset mix", "yield APY" / "protocol APY".

- [ ] **Step 2: Write the module**

```ts
// src/lib/test-mode/seed/analytics.ts
import type { SeedContext } from './helpers';
import { rand } from './helpers';

export async function seedAnalytics(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  // ─── Part 1: 75 daily treasury_state_snapshots ───────────────────────
  // Anchor: the current aggregate of seeded balances. We could compute it from
  // wallet_balances + bank_accounts + yield_positions, but for demo purposes
  // a fixed anchor with a small random walk is fine.
  const currentTotalUsd = 3_200_000;         // matches current seeded treasury scale
  const currentFiatUsd = 450_000;
  const currentStableUsd = 2_000_000;
  const currentDefiUsd = 750_000;

  const snapshotRows = [];
  let total = currentTotalUsd;
  let fiat = currentFiatUsd;
  let stable = currentStableUsd;
  let defi = currentDefiUsd;

  for (let d = 0; d < 75; d++) {
    // Walk backward from today, small random daily drift
    const takenAt = new Date(Date.now() - d * 86_400_000).toISOString();
    // Rebalance composition slightly each day
    const drift = rand(-0.02, 0.02);
    total = Math.max(total * (1 + drift), 1_500_000);
    fiat = Math.max(fiat * (1 + rand(-0.03, 0.03)), 200_000);
    stable = Math.max(stable * (1 + rand(-0.02, 0.02)), 1_000_000);
    defi = Math.max(defi * (1 + rand(-0.03, 0.03)), 300_000);

    snapshotRows.push({
      enterprise_id: enterpriseId,
      taken_at: takenAt,
      taken_by: userId,
      trigger: 'scheduled',
      base_currency: 'USD',
      total_value_base_usd: total.toFixed(2),
      total_fiat_base_usd: fiat.toFixed(2),
      total_stablecoin_base_usd: stable.toFixed(2),
      total_defi_base_usd: defi.toFixed(2),
      positions: [
        { assetSymbol: 'USDC', chain: 'ethereum', venueKind: 'wallet', amount: stable * 0.7, unitPriceUsd: 1, valueUsd: stable * 0.7 },
        { assetSymbol: 'USDT', chain: 'ethereum', venueKind: 'wallet', amount: stable * 0.3, unitPriceUsd: 1, valueUsd: stable * 0.3 },
      ],
      fx_rates: { 'USD/EUR': 0.92, 'USD/GBP': 0.79 },
    });
  }

  // Insert in chunks of 25 to respect Supabase row limits
  for (let i = 0; i < snapshotRows.length; i += 25) {
    const chunk = snapshotRows.slice(i, i + 25);
    const { error } = await supabase.from('treasury_state_snapshots').insert(chunk);
    if (error) { console.error('[seed:analytics] snapshot chunk failed', error); break; }
  }

  // ─── Part 2: analytics_pin_preferences — 3 pinned slugs ───────────────
  // Slugs MUST match entries in src/lib/analytics/standard-views.ts. Pre-verify.
  const pinnedSlugs = [
    'obligation-coverage-30d',
    'stablecoin-mix',
    'yield-apy-by-protocol',
  ];
  const { error: pinErr } = await supabase.from('analytics_pin_preferences').insert({
    user_id: userId,
    enterprise_id: enterpriseId,
    pinned_slugs: pinnedSlugs,
  });
  if (pinErr) console.error('[seed:analytics] pin preferences failed', pinErr);

  console.log('[seed:analytics] ✓ 75 snapshots + 3 pinned views');
}
```

- [ ] **Step 3: Reconcile slug names against the actual registry**

Open `src/lib/analytics/standard-views.ts` and replace the three strings in `pinnedSlugs` with slugs that actually exist. If exact matches for the three intended measures don't exist, pick any 3 valid slugs — the goal is a non-empty pinned set, not specific measures.

- [ ] **Step 4: Commit**

```bash
git add src/lib/test-mode/seed/analytics.ts
git commit -m "feat(test-seed): add analytics seed — 75-day snapshots + 3 pinned views"
```

---

## Task 4: Create `insights.ts` seed module

**Files:**
- Create: `src/lib/test-mode/seed/insights.ts`

- [ ] **Step 1: Read reference material**

Read migration 0040 (especially the enum definitions and table columns). Note that `state` values are `'new' | 'viewed' | 'dismissed' | 'acted_on' | 'expired'` — **use `'viewed'` where the spec said `'acknowledged'`**. Read `scripts/seed.ts` lines 1416-1700 for examples of realistic `rationale` + `recommended_action` JSON shapes.

- [ ] **Step 2: Write the module**

```ts
// src/lib/test-mode/seed/insights.ts
import type { SeedContext } from './helpers';
import { daysAgo } from './helpers';

export async function seedInsights(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const rows = [
    // 1. CRITICAL liquidity_below_buffer — new, purple agent signature
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'liquidity_buffer_detector',
      insight_type: 'liquidity_below_buffer',
      severity: 'critical', state: 'new',
      title: 'Liquidity buffer dips below 1.5× on day 7',
      summary: 'Forecast shows coverage falling below the 1.5× buffer between days 7-11.',
      ai_reasoning: 'Forecast engine projects a 3-day dip below the 1.5× buffer between day 7 and day 11 of the forecast window. Recommended action is a $350K USDC onramp from JPMorgan Operating Account, which restores coverage for the full 30-day window. This insight is linked to the pending AI recommendation in the approvals queue — approving the recommendation resolves the insight.',
      ai_model: 'claude-sonnet-4-6',
      rationale: { buffer_target: 1.5, projected_min_coverage_ratio: 1.32, dip_start_day: 7, dip_end_day: 11 },
      recommended_action: { kind: 'onramp', amount_usd: 350000, asset: 'USDC', from_account: 'JPMorgan Operating' },
      policy_verdict: 'require_approval', policy_reason: 'AI-initiated movement — always requires human approval',
      impact_dollar_value: 350000, impact_buffer_days: 4,
      confidence: 0.92, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(0),
    },
    // 2. CRITICAL concentration_breach — new, purple signature
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'concentration_detector',
      insight_type: 'concentration_breach',
      severity: 'critical', state: 'new',
      title: 'USDC concentration exceeds 60% hard limit',
      summary: 'USDC is 73% of total stablecoin holdings, breaching the 60% concentration limit.',
      ai_reasoning: 'Current holdings are USDC $2.14M / USDT $790K. USDC concentration of 73% exceeds the 60% hard limit set in policy v3. Recommend swapping $200K USDC → USDT to bring concentration to ~58% and restore policy compliance.',
      ai_model: 'claude-sonnet-4-6',
      rationale: { usdc_pct: 73, usdt_pct: 27, limit_pct: 60 },
      recommended_action: { kind: 'swap', from_asset: 'USDC', to_asset: 'USDT', amount_usd: 200000 },
      policy_verdict: 'require_approval', policy_reason: 'AI-initiated movement — always requires human approval',
      impact_dollar_value: 200000, confidence: 0.95, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(0),
    },
    // 3. WARNING yield_drop — new
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'yield_drop_detector',
      insight_type: 'yield_drop', severity: 'warning', state: 'new',
      title: 'Morpho Reservoir APY dropped 180bps in 7 days',
      summary: 'APY fell from 7.0% → 5.2%. Consider rebalancing to Aave.',
      ai_reasoning: null, ai_model: null,
      rationale: { protocol: 'morpho_reservoir', apy_before: 7.0, apy_now: 5.2, window_days: 7 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      impact_apy_delta_bps: -180, confidence: 0.88, data_freshness: 'fresh',
      venue_category: 'defi_lending', supporting_data: {},
      created_at: daysAgo(1),
    },
    // 4. WARNING yield_opportunity — VIEWED
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'yield_opportunity_detector',
      insight_type: 'yield_opportunity', severity: 'warning', state: 'viewed',
      title: 'Kamino (Solana) APY 8.1% — 130bps above current Aave allocation',
      summary: 'Consider rebalancing $150K from Aave to Kamino for a 130bps APY uplift.',
      ai_reasoning: null, ai_model: null,
      rationale: { target_protocol: 'kamino', target_apy: 8.1, current_protocol: 'aave_v3', current_apy: 6.8 },
      recommended_action: { kind: 'rebalance', from_protocol: 'aave_v3', to_protocol: 'kamino', amount_usd: 150000 },
      policy_verdict: 'require_approval', policy_reason: 'AI-initiated movement — always requires human approval',
      impact_apy_delta_bps: 130, impact_dollar_value: 150000,
      confidence: 0.78, data_freshness: 'fresh',
      venue_category: 'defi_lending', supporting_data: {},
      created_at: daysAgo(3),
    },
    // 5. WARNING yield_idle_opportunity — new
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'idle_cash_detector',
      insight_type: 'yield_idle_opportunity', severity: 'warning', state: 'new',
      title: '$450K idle in operating wallet for 14 days',
      summary: 'Move idle cash to Spiko USD MMF for 4.8% APY.',
      ai_reasoning: null, ai_model: null,
      rationale: { idle_amount_usd: 450000, idle_days: 14, suggested_venue: 'spiko_usd', suggested_apy: 4.8 },
      recommended_action: { kind: 'mmf_deposit', venue: 'spiko_usd', amount_usd: 450000 },
      policy_verdict: null, policy_reason: null,
      impact_dollar_value: 450000, impact_apy_delta_bps: 480,
      confidence: 0.82, data_freshness: 'fresh',
      venue_category: 'tokenized_mmf', supporting_data: {},
      created_at: daysAgo(2),
    },
    // 6. INFO concentration_warning — new
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'concentration_detector',
      insight_type: 'concentration_warning', severity: 'info', state: 'new',
      title: 'Ethereum chain holds 91% of stablecoin exposure',
      summary: 'Chain concentration is high. Consider diversifying to Solana.',
      ai_reasoning: null, ai_model: null,
      rationale: { ethereum_pct: 91, solana_pct: 9 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      confidence: 0.75, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(4),
    },
    // 7. INFO yield_opportunity — DISMISSED
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'yield_opportunity_detector',
      insight_type: 'yield_opportunity', severity: 'info', state: 'dismissed',
      title: 'Ondo OUSG offers 4.5% APY on $500K+ allocations',
      summary: 'Tokenized US Treasuries — stable yield alternative.',
      ai_reasoning: null, ai_model: null,
      rationale: { protocol: 'ondo_ousg', apy: 4.5, min_size_usd: 500000 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      confidence: 0.70, data_freshness: 'fresh',
      venue_category: 'tokenized_mmf', supporting_data: {},
      created_at: daysAgo(6),
    },
    // 8. INFO liquidity_idle_cash — VIEWED
    {
      enterprise_id: enterpriseId, user_id: userId,
      detector_name: 'idle_cash_detector',
      insight_type: 'liquidity_idle_cash', severity: 'info', state: 'viewed',
      title: '$85K in HSBC GBP account has been idle for 30 days',
      summary: 'Consider FX-offramping to USD for operational use.',
      ai_reasoning: null, ai_model: null,
      rationale: { account: 'HSBC GBP', idle_amount_gbp: 67000, idle_days: 30 },
      recommended_action: null, policy_verdict: null, policy_reason: null,
      confidence: 0.65, data_freshness: 'fresh',
      venue_category: null, supporting_data: {},
      created_at: daysAgo(5),
    },
  ];

  const { error } = await supabase.from('treasury_insights').insert(rows);
  if (error) console.error('[seed:insights] insert failed', error);
  else console.log('[seed:insights] ✓ 8 insights (2 critical w/ agent, 3 warning, 3 info)');
}
```

- [ ] **Step 3: Handle the `channel` column**

If `tsc` or runtime surfaces a NOT-NULL error on `channel`, add `channel: 'deterministic'` to every row. If no error, leave it off.

- [ ] **Step 4: Commit**

```bash
git add src/lib/test-mode/seed/insights.ts
git commit -m "feat(test-seed): add insights seed — 8 hand-crafted across severity/state/category"
```

---

## Task 5: Create `notifications.ts` seed module

**Files:**
- Create: `src/lib/test-mode/seed/notifications.ts`

- [ ] **Step 1: Confirm event_type values**

Grep `src/lib/notifications/` or similar for the allowed `event_type` strings used by the bell icon. Migration 0023 doesn't constrain the value — the UI does. Reasonable defaults: `'insight_critical'`, `'approval_needed'`, `'policy_triggered'`, `'compliance_alert'`, `'system'`. If the UI expects different strings, substitute.

- [ ] **Step 2: Write the module**

```ts
// src/lib/test-mode/seed/notifications.ts
import type { SeedContext } from './helpers';

export async function seedNotifications(ctx: SeedContext): Promise<void> {
  const { supabase, enterpriseId, userId } = ctx;

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600 * 1000).toISOString();
  const daysAgoStr = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  const rows = [
    // 5 UNREAD (newest-first within unread group)
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'insight_critical', category: 'treasury',
      title: 'Liquidity buffer at risk', body: 'Buffer drops below 1.5× on day 7. Review recommended action.',
      metadata: {}, link: '/treasury', read: false, created_at: hoursAgo(2) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'approval_needed', category: 'approvals',
      title: 'Approval needed: $750K off-ramp', body: '2 approvers required per policy v3.',
      metadata: {}, link: '/approvals', read: false, created_at: hoursAgo(4) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'approval_needed', category: 'approvals',
      title: 'Approval needed: $600K yield deposit', body: 'Aave deposit pending approver action.',
      metadata: {}, link: '/approvals', read: false, created_at: daysAgoStr(1) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'policy_triggered', category: 'policy',
      title: 'Policy v3 activated', body: 'New rule: SoD required on yield deposits >$500K.',
      metadata: {}, link: '/policy', read: false, created_at: daysAgoStr(1) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'compliance_alert', category: 'compliance',
      title: 'KYT alert: unusual counterparty pattern', body: 'Review transfer to new counterparty.',
      metadata: {}, link: '/compliance', read: false, created_at: daysAgoStr(2) },
    // 5 READ
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'insight_critical', category: 'treasury',
      title: 'USDC concentration breach', body: '73% exceeds 60% limit.',
      metadata: {}, link: '/treasury', read: true, created_at: daysAgoStr(3) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'system', category: 'system',
      title: 'Xero ERP connected', body: 'Demo Company sync complete. 47 invoices imported.',
      metadata: {}, link: '/settings/erp', read: true, created_at: daysAgoStr(5) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'policy_triggered', category: 'policy',
      title: 'Policy v2 activated', body: 'Daily outflow cap $2M added.',
      metadata: {}, link: '/policy', read: true, created_at: daysAgoStr(7) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'approval_needed', category: 'approvals',
      title: 'Approval resolved: $300K vendor wire', body: 'Q1 audit firm payment approved.',
      metadata: {}, link: '/approvals', read: true, created_at: daysAgoStr(10) },
    { enterprise_id: enterpriseId, user_id: userId, event_type: 'system', category: 'system',
      title: 'Welcome to Vantor', body: 'Your test enterprise is ready. Explore the demo data.',
      metadata: {}, link: '/', read: true, created_at: daysAgoStr(14) },
  ];

  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('[seed:notifications] insert failed', error);
  else console.log('[seed:notifications] ✓ 10 notifications (5 unread, 5 read)');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/test-mode/seed/notifications.ts
git commit -m "feat(test-seed): add notifications seed — 10 rows across 5 event types"
```

---

## Task 6: Wire new modules into `seed-all.ts`

**Files:**
- Modify: `src/lib/test-mode/seed/seed-all.ts`

- [ ] **Step 1: Open the file**

Current content ends at line 62 with `await seedCompliance(ctx, walletIds, txIds); await seedAudit(ctx);`.

- [ ] **Step 2: Apply the edit**

Replace the imports block and the end of `seedAll` with:

```ts
import { createAdminClient } from '@/lib/supabase/admin';
import type { SeedContext } from './helpers';
import { seedWallets } from './wallets';
import { seedBanking } from './banking';
import { seedErp } from './erp';
import { seedTransactions, seedFiatPayments } from './transactions';
import { seedSwaps } from './swaps';
import { seedBridges } from './bridges';
import { seedTreasury } from './treasury';
import { seedYield } from './yield';
import { seedCompliance } from './compliance';
import { seedAudit } from './audit';
import { seedPolicy } from './policy';
import { seedApprovals } from './approvals';
import { seedAnalytics } from './analytics';
import { seedInsights } from './insights';
import { seedNotifications } from './notifications';
```

At the end of `seedAll`, after `await seedAudit(ctx);`, add:

```ts
  // Phase 6: Policy + approvals + analytics + insights + notifications.
  // Ordering:
  //   - policy first (approvals reference active version + chain)
  //   - analytics + insights can run in parallel (no deps on each other)
  //   - notifications last (references state that's now fully seeded)
  const policyIds = await seedPolicy(ctx);
  if (policyIds) {
    await seedApprovals(ctx, policyIds.v3Id, policyIds.chainId);
  }
  await Promise.all([
    seedAnalytics(ctx),
    seedInsights(ctx),
  ]);
  await seedNotifications(ctx);
```

- [ ] **Step 3: Run `tsc --noEmit` to catch any type errors**

Run:

```bash
cd C:/Users/John/crypto-treasury/.worktrees/test-seed-demo-data
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors related to the new seed modules. If there are errors about `channel` on `treasury_insights`, go back to Task 4 Step 3 and add `channel: 'deterministic'` to each row.

- [ ] **Step 4: Commit**

```bash
git add src/lib/test-mode/seed/seed-all.ts
git commit -m "feat(test-seed): wire Phase 6 — policy, approvals, analytics, insights, notifications"
```

---

## Task 7: Update `wipe.ts` for new tables

**Files:**
- Modify: `src/lib/test-mode/seed/wipe.ts`

- [ ] **Step 1: Understand FK ordering**

New tables to wipe, in FK-safe delete order (children before parents):

```
notifications                  (no FK deps)
treasury_insights              (no FK deps from these)
analytics_pin_preferences      (no FK deps)
treasury_state_snapshots       (forecast_snapshots would reference this, but seed doesn't insert any)
policy_hard_limits             (FK → policy_versions)
policy_rules                   (FK → policy_versions, → policy_approval_chains)
policy_approval_chains         (FK → policy_versions)
policy_versions                (FK → enterprises, self-ref via superseded_by_version_id)
policy_policies                (FK → policy_versions via active_version_id — null out first)
```

**Skipped:** `policy_approval_requests` (`_no_delete` rule). Fresh signups start clean; repeated "Reset test data" clicks accumulate rows only in this table.

- [ ] **Step 2: Edit `wipe.ts`**

In the `tables` array (line 28-57 of current file), insert new entries in this order. The exact placement: add `notifications` at the top (before `audit_logs`), then insert the policy/analytics/insights block after `yield_positions` (line 35). Policy parents need a null-out step on `policy_policies.active_version_id` before the row delete.

Apply this replacement (the full new `tables` array):

```ts
  const tables = [
    'notifications',
    'audit_logs',
    'travel_rule_transfers',
    'kyt_alerts',
    'kyt_transfers',
    'sanctions_screenings',
    'yield_transactions',
    'yield_positions',
    'treasury_insights',
    'analytics_pin_preferences',
    'treasury_state_snapshots',
    'policy_hard_limits',
    'policy_rules',
    'policy_approval_chains',
    'policy_versions',
    'policy_policies',
    'simulation_runs',
    'ai_recommendations',
    'obligations',
    'treasury_rules',
    'bridge_transfers',
    'swaps',
    'transfer_attempts',
    'transfers',
    'transactions',
    'bill_payments',
    'invoices',
    'erp_vendors',
    'erp_configurations',
    'fiat_transactions',
    'fiat_payments',
    'bank_accounts',
    'balance_snapshots',
    'wallet_balances',
    'wallets',
  ];
```

- [ ] **Step 3: Handle `policy_policies.active_version_id` null-out**

Inside the `for (const table of tables)` loop, add a special-case before the generic delete, directly after the `erp_vendors` block (around line 87):

```ts
    if (table === 'policy_versions') {
      // Null out policy_policies.active_version_id before deleting versions (FK constraint)
      await supabase
        .from('policy_policies')
        .update({ active_version_id: null })
        .eq('enterprise_id', testEnterpriseId);
      // Also null out superseded_by_version_id self-refs
      const { data: vs } = await supabase
        .from('policy_versions').select('id').eq('enterprise_id', testEnterpriseId);
      if (vs?.length) {
        await supabase
          .from('policy_versions')
          .update({ superseded_by_version_id: null })
          .in('id', vs.map(v => v.id));
      }
      await supabase.from('policy_versions').delete().eq('enterprise_id', testEnterpriseId);
      continue;
    }
```

- [ ] **Step 4: Run tsc**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors in `wipe.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/test-mode/seed/wipe.ts
git commit -m "feat(test-seed): wipe new tables (policy, analytics, insights, notifications)"
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Start dev server**

In a separate terminal:

```bash
cd C:/Users/John/crypto-treasury/.worktrees/test-seed-demo-data
npm run dev
```

Wait for `Ready in Xs` line. **Don't leave running after this task** — per memory, Next dev server on this Windows machine has a memory leak. Kill when done.

- [ ] **Step 2: Register a fresh test user**

Navigate to http://localhost:3000/register. Use a unique email like `seedtest-YYMMDD-HHMM@example.com`. Watch the dev-server console for:

```
[seed:policy] ✓ 1 policy + 3 versions (v3 active) ...
[seed:approvals] ✓ 6 approval requests ...
[seed:analytics] ✓ 75 snapshots + 3 pinned views
[seed:insights] ✓ 8 insights ...
[seed:notifications] ✓ 10 notifications ...
```

If any of them error, fix and re-run the `/api/test-mode/reseed` endpoint (or re-register).

- [ ] **Step 3: Verify each surface**

Sign in, toggle test mode, and confirm:

- **`/policy`** — 1 active policy ("Standard Policy"), v3 active, version history shows 3 versions with activation timestamps
- **`/approvals`** — tabs show "Pending (2)", "Approved (2)", "Denied (2)"; each row opens a detail dialog with realistic context
- **`/analytics`** — time-series charts show 75-day trend lines (not single points); 3 views pinned
- **`/treasury`** — insights panel shows 8 insights; 2 critical show purple agent signature; severities/states bucket correctly
- **Bell icon (topbar)** — unread count = 5; dropdown shows 10 rows; clicking one navigates correctly

- [ ] **Step 4: Verify reseed idempotency**

In Settings → Test Mode (or wherever the button lives), click "Reset test data". Watch server console for wipe + reseed logs (no FK errors). Re-verify all surfaces render cleanly.

Expected known-debt: `/approvals` may show stale rows from the previous seed pass because we skip wiping `policy_approval_requests`. This is the documented non-goal; flag but do not fix.

- [ ] **Step 5: Verify MMF positions still render**

Navigate to `/yield`. Confirm 3 MMF positions (Spiko USD / Circle USYC / Ondo OUSG) still render in the Cash & Cash Equivalents card. This is a regression check — we didn't touch yield seed, but any wipe/FK bug could have stranded rows.

- [ ] **Step 6: Kill the dev server**

```bash
# in the dev server terminal
Ctrl+C
# Or find + kill the process:
netstat -ano -p tcp | grep ':3000 '
taskkill //F //PID <pid>
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feature/test-seed-demo-data
gh pr create --title "feat(test-seed): demo data for policy, approvals, analytics, insights, notifications" --body "$(cat <<'EOF'
## Summary

Fresh test enterprises now render non-empty state across /policy, /approvals, /analytics, /treasury insights, and the notifications bell. Five new modules in src/lib/test-mode/seed/ run as Phase 6 of seedAll. wipe.ts gains 7 new tables in FK-safe order.

## Test plan

- [x] Register new user → all 5 seed modules log success
- [x] /policy shows 3 versions with v3 active
- [x] /approvals tabs show (2, 2, 2)
- [x] /analytics has 75-day trend lines + 3 pinned views
- [x] /treasury shows 8 insights across severity/state
- [x] Bell icon shows 5 unread
- [x] Existing surfaces (wallets, yield MMFs, compliance) unchanged

## Non-goals (not fixed in this PR)

- policy_approval_requests is skipped in wipe.ts (the `_no_delete` rewrite rule blocks deletes). Fresh signups are clean; repeated "Reset test data" accumulates rows here only.

Spec: docs/superpowers/specs/2026-04-13-test-seed-demo-data-design.md
Plan: docs/superpowers/plans/2026-04-13-test-seed-demo-data.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Results

**Spec coverage:**
- Policy 3-version history → Task 1 ✓
- Approvals 6-row mix → Task 2 ✓
- 75-day snapshots + 3 pinned views → Task 3 ✓
- 8 hand-crafted insights → Task 4 ✓
- 10 notifications → Task 5 ✓
- seed-all wiring → Task 6 ✓
- wipe.ts updates → Task 7 ✓
- End-to-end verification → Task 8 ✓

**Placeholder scan:** No TBDs, TODOs, or "implement later" notes. Each step has runnable code or exact commands.

**Type consistency:** `PolicyIds.v3Id` and `chainId` defined in Task 1, consumed as positional args in Task 6 and Task 2 — matching names and shapes.

**Known deviations from spec:** Spec field names corrected against real schema (see Schema Reference section at top). Spec said `status='published'` → real schema uses `'active'`; spec said `state='acknowledged'` → real enum uses `'viewed'`; spec said `analytics_pins` (one row per pin) → real table is `analytics_pin_preferences` (one row per user with `pinned_slugs` array).
