# Test-Enterprise Seed — Demo Data Refresh

**Date:** 2026-04-13
**Branch:** `feature/test-seed-demo-data`
**Worktree:** `.worktrees/test-seed-demo-data`

## Problem

When a new user signs up at `vantor.xyz/register`, the app creates a parallel "test enterprise" and runs `seedAll` from `src/lib/test-mode/seed/seed-all.ts` to populate it with demo data. The same seeder re-runs on every click of the "Reset test data" button (`POST /api/test-mode/reseed`).

Today's seed covers wallets, banking, ERP, transactions, swaps, bridges, treasury (rules + obligations + AI recs), yield (incl. MMF positions), compliance, and audit logs. It does **not** seed:

- **Policy engine** — no policy_policies, no versions, no rules/limits/chains. `/policy` renders empty state.
- **Approvals queue** — no policy_approval_requests. `/approvals` renders empty state.
- **Analytics** — no treasury_state_snapshots history (only current), no analytics_pins saved views. `/analytics` charts show single data points and no saved views.
- **Insights (Treasury AI)** — no treasury_insights. `/treasury` insights panel is empty.
- **Notifications** — `notifications` table exists and is in wipe list, but no inserts. Bell icon is always empty on fresh test enterprise.

A test user signing up or hitting reseed should see a rich, pre-populated demo state across every surface of the app — not just the domains the seed currently covers.

## Non-goals

- No changes to `scripts/seed.ts` (the separate manual dev tool invoked by `npm run seed`). That script has its own hand-seeded insights block; leaving it alone avoids scope creep.
- No changes to existing seed modules (wallets, banking, erp, transactions, swaps, bridges, treasury, yield, compliance, audit) — they're working as intended and already cover MMFs, payments, and ramps adequately.
- No runtime detector invocation during seed. Hand-seeded insights are sufficient for demo coverage; importing detector code into the signup path adds cost + coupling with no demo benefit.
- No wipe logic for `policy_approval_requests` on reseed. The `_no_delete` rewrite rule on that table makes wipe nontrivial, and fresh signups always start clean (new test enterprise, no prior rows). The only case where rows accumulate is repeated clicks of "Reset test data" within the same enterprise, which is a demo-owner issue not a user-facing one.

## Design

Add five new modules to `src/lib/test-mode/seed/` and wire them into `seed-all.ts`.

### 1. `policy.ts` — Policy engine demo state

**Tables touched:** `policy_policies`, `policy_versions`, `policy_rules`, `policy_hard_limits`, `policy_approval_chains`

**Behavior:**
- Insert 1 `policy_policies` row for the test enterprise.
- Insert 3 `policy_versions`:
  - **v1** — `status='published'`, `published_at = now() - 30d`. Baseline policy: $50K/$500K/$1M approval ladder, no forecast-based rules.
  - **v2** — `status='published'`, `published_at = now() - 10d`. Adds one hard limit (daily outflow cap $2M) and one approval chain rule (require exec for >$250K cross-chain transfers).
  - **v3** — `status='active'`, `published_at = now() - 1d`. Clone of v2 + one additional rule (require SoD on yield deposits >$500K). `policy_policies.active_version_id = v3.id`.
- Each version gets its own `policy_rules`, `policy_hard_limits`, `policy_approval_chains` children.

**UI surfaces it populates:**
- `/policy` dashboard — shows 1 active policy with 3 versions in history
- `/policy/[id]/diff` — can diff any version pair
- `/policy/[id]/simulate` — can replay historical evaluations
- Sidebar "Policy" entry — shows non-zero rule count

**Dependencies:** None. Runs in Phase 6 before approvals (so approval_requests can reference v3.id).

---

### 2. `approvals.ts` — Approvals queue demo state

**Tables touched:** `policy_approval_requests`

**Behavior:**
- Insert 6 `policy_approval_requests` rows scoped to the test enterprise + policy v3:
  - **2 pending** — one $750K USDC→bank off-ramp (1-day-old), one $600K yield deposit on Aave (3-hours-old). Both require 2 approvers per v3 rules.
  - **2 approved** — one $300K vendor wire (approved 2d ago by executive user, with `approved_at` + `approved_by` + `decision_reason='Vendor payment — Q1 audit firm'`), one $1.2M intra-wallet rebalance (approved 5d ago, 2-approver chain completed).
  - **2 denied** — one $450K yield withdraw (denied 1d ago with `denial_reason='Better rates expected next week per treasury-ai insight'`), one $2.1M cross-chain bridge (denied 6d ago with `denial_reason='Exceeds daily outflow hard limit'`).
- Each request links to a `target_kind` (`transfer` / `yield_deposit` / `yield_withdraw` / `bridge`) and a synthetic `target_ref` describing the mock operation. They do NOT need to link to real rows in transfers/yield — the `/approvals` list renders from `policy_approval_requests` fields directly.

**UI surfaces it populates:**
- `/approvals` — list shows 6 rows with correct tab counts (pending 2, approved 2, denied 2)
- `ApprovalDetailDialog` — opens for any row, shows realistic context

**Dependencies:** Policy v3 must exist. Runs after `policy.ts`.

---

### 3. `analytics.ts` — Analytics saved views + history

**Tables touched:** `treasury_state_snapshots`, `analytics_pins`

**Behavior:**
- **Snapshot backfill:** Generate 75 daily `treasury_state_snapshots` rows from 75 days ago through yesterday. Each row reflects total stablecoin balance + bank balance + yield balance at a slight random walk off the current seeded state (±1-3% daily drift, always stays above the seeded obligation coverage floor). Reuses the existing `balanceHistory` helper pattern.
- **Saved views:** Insert 3 `analytics_pins` rows:
  - "30-day Obligation Coverage" — measure `obligation_coverage_ratio`, window `last_30d`
  - "Stablecoin Mix (USDC vs USDT)" — measure `stablecoin_composition`, window `last_90d`
  - "Top Protocols by Yield APY" — measure `yield_apy_by_protocol`, window `last_30d`

Measure names match `src/lib/analytics/measures.ts`. If any measure name I've picked here doesn't match the actual registry, the implementation task will substitute the closest existing measure.

**UI surfaces it populates:**
- `/analytics` — all time-series charts now have 75 days of history instead of a single point
- `/analytics` saved-views sidebar — 3 pre-loaded views ready to open
- Report Builder — sections that read from snapshots or measures show real trends

**Dependencies:** Runs after `treasury.ts` (needs current obligations + treasury state to anchor the walk).

---

### 4. `insights.ts` — Treasury AI insights

**Tables touched:** `treasury_insights`

**Behavior:**
- Insert 8 hand-crafted `treasury_insights` rows covering the full UI state matrix:

| # | Severity | Category | Status | Agent signature? |
|---|---|---|---|---|
| 1 | critical | liquidity_below_buffer | new (unread) | yes — purple |
| 2 | critical | concentration_breach | new | yes — purple |
| 3 | warning | yield_drop | new | no |
| 4 | warning | yield_opportunity | acknowledged | no |
| 5 | warning | yield_idle_opportunity | new | no |
| 6 | info | concentration_warning | new | no |
| 7 | info | yield_opportunity | dismissed | no |
| 8 | info | liquidity_idle_cash | acknowledged | no |

All rows get `channel='deterministic'` per the two-channel model established in Phase 0 (Agent Surfaces foundation). Two rows get non-null `agent_signature_*` fields (purple UI accent) to demo the agent-reasoning surface. Each row includes a realistic `ai_reasoning` string; rows with purple signature include extended Claude reasoning.

**UI surfaces it populates:**
- `/treasury` insights panel — 8 insights visible, correctly bucketed by severity + status
- Bell icon — unread count reflects `status='new'` rows
- Insight detail drawers — full reasoning visible

**Dependencies:** Runs after `treasury.ts` (references the current treasury state for realistic numbers).

---

### 5. `notifications.ts` — Global notifications

**Tables touched:** `notifications`

**Behavior:**
- Insert 10 `notifications` rows spanning the last 14 days, mix of read/unread:

| # | Type | Read? | Age |
|---|---|---|---|
| 1 | insight_critical | unread | 2h ago |
| 2 | approval_needed | unread | 4h ago |
| 3 | approval_needed | unread | 1d ago |
| 4 | policy_triggered | unread | 1d ago |
| 5 | compliance_alert | unread | 2d ago |
| 6 | insight_critical | read | 3d ago |
| 7 | system | read | 5d ago |
| 8 | policy_triggered | read | 7d ago |
| 9 | approval_needed | read | 10d ago |
| 10 | system | read | 14d ago |

Each row includes a human `title`, `body`, and a `href` that deep-links to the relevant surface (`/approvals`, `/policy`, `/compliance`, `/treasury`). Types match the existing notification types accepted by the bell-icon component.

**UI surfaces it populates:**
- Topbar bell icon — shows unread count = 5
- Notifications dropdown — 10 rows, newest first
- Clicking any row navigates correctly

**Dependencies:** Runs last (references insights + approvals + policy that were just created in same phase).

---

### Wiring: `seed-all.ts` changes

Add imports for the 5 new modules. Append Phase 6 after `seedAudit`:

```ts
// Phase 6: Policy engine + approvals + analytics + insights + notifications
//   policy → approvals (depends on policy v3.id)
//   treasury (already run in phase 3) → analytics + insights
//   everything → notifications
await seedPolicy(ctx);
await seedApprovals(ctx);
await Promise.all([
  seedAnalytics(ctx),
  seedInsights(ctx),
]);
await seedNotifications(ctx);
```

`seedPolicy` returns the active version id so `seedApprovals` can reference it. Other modules don't need cross-returns.

### Wiping: `wipe.ts` changes

Add these tables to the existing delete list, in FK-safe order:
- `notifications` (no children)
- `treasury_insights` (no children)
- `analytics_pins` (no children)
- `treasury_state_snapshots` (forecast_snapshots already deleted earlier — check order)
- `policy_approval_chains`, `policy_hard_limits`, `policy_rules` (children of versions)
- `policy_policies` (null out `active_version_id` first)
- `policy_versions`

Skip `policy_approval_requests` per non-goal above.

### Migrations

**None.** All target tables exist from prior migrations (0038 policy, 0040 insights, 0042 snapshots, 0023 notifications, 0048 analytics pins).

## File changes summary

| File | Change | Est. LOC |
|---|---|---|
| `src/lib/test-mode/seed/policy.ts` | new | ~120 |
| `src/lib/test-mode/seed/approvals.ts` | new | ~80 |
| `src/lib/test-mode/seed/analytics.ts` | new | ~90 |
| `src/lib/test-mode/seed/insights.ts` | new | ~140 |
| `src/lib/test-mode/seed/notifications.ts` | new | ~80 |
| `src/lib/test-mode/seed/seed-all.ts` | +6 imports, +Phase 6 block | ~15 added |
| `src/lib/test-mode/seed/wipe.ts` | add 8 tables to delete order | ~12 added |
| **Total** | | ~537 LOC added, 0 removed |

## Testing

No unit tests for seed modules (consistent with existing convention — none of the existing seed modules have tests). Verification is end-to-end:

1. In worktree, run `npm run build` to catch TS errors.
2. Start dev server, register a new user, confirm each surface renders seeded data:
   - `/policy` — 3 versions, v3 active
   - `/approvals` — 6 rows, correct tab counts
   - `/analytics` — 75-day trend lines, 3 saved views
   - `/treasury` — 8 insights in correct buckets
   - Bell icon — unread count = 5
3. Click "Reset test data" on an existing test enterprise, confirm all domains re-seed cleanly (including that wipe respects FK order on the new tables).
4. Confirm existing surfaces (wallets, transactions, yield MMFs, compliance) are unchanged.

## Risks

- **FK ordering in wipe.ts** — if we get delete order wrong, wipe fails mid-way and leaves partial state. Mitigation: test wipe-then-reseed loop 3x before calling done.
- **Measure name mismatch in analytics_pins** — if my assumed measure keys don't exist in `src/lib/analytics/measures.ts`, the pins render broken charts. Mitigation: implementation task reads the actual measure registry first and maps to real keys.
- **Snapshot backfill + existing forecast_snapshots** — `forecast_snapshots` has a NOT-NULL FK to `treasury_state_snapshots`. Backfilling 75 rows of snapshots means forecast_snapshots may end up orphaned if we don't coordinate. Mitigation: the existing treasury.ts doesn't insert forecast_snapshots for seed data (verified by grep), so no collision.
- **`notifications` table schema drift** — migration 0023 defines the table but column names may have evolved. Mitigation: implementation reads current schema before writing seed rows.

## Open questions

None at spec-write time. All decisions made during brainstorming.
