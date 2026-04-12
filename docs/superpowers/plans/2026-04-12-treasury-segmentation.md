# Treasury Segmentation Alignment — Implementation Plan (Phase C-1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the DB-vs-UX segmentation mismatch so tokenized MMFs roll into Cash instead of DeFi, and kill the "fiat" vocabulary across the treasury state layer.

**Branch:** `feature/treasury-segmentation` (worktree at `.worktrees/treasury-segmentation`)

**Context note:** `project_treasury_segmentation_mismatch.md`

---

## The problem, concretely

`treasury_state_snapshots` (migration 0042) has three aggregate columns that don't match Vantor's actual treasury model defined in `src/lib/treasury/holdings-category.ts`:

| Column (current) | What writer puts in | Should be |
|---|---|---|
| `total_fiat_base_usd` | ALL bank account balances | Rename → `total_bank_base_usd`. Just banks. |
| `total_stablecoin_base_usd` | ALL wallet balances (incl. ETH, SOL, misc tokens) | Only idle stablecoin balances (USDC/USDT). Non-stable tokens → `total_other_base_usd`. |
| `total_defi_base_usd` | ALL yield positions (incl. tokenized MMFs) | DeFi-category positions only. MMFs → new `total_mmf_base_usd`. |

Downstream consumers (12 files, confirmed by grep) read these columns or the camelCase view. The analytics engine inherits the miscategorization, which surfaces as "MMFs nowhere / DeFi inflated" on the `/analytics` page.

UI-facing vocabulary (per `feedback_vantor_bank_wallet_vocab.md` + `feedback_vantor_stablecoin_vocab.md`):
- "Bank" for off-chain balances (not "fiat")
- "MMFs" for tokenized money market funds
- "Cash" = Bank + MMFs (the UX rollup)
- "Stablecoins" for idle USDC/USDT in self-custody wallets (not "crypto")
- "DeFi Positions" for yield venues that are truly DeFi (Aave/Compound/Morpho/Kamino/etc)
- "Other" for ETH/SOL and anything unrecognized

## Scope of THIS plan (Phase C-1.5)

In scope:
- Migration 0049: add new columns alongside old ones (keep dual-write)
- Refactor the snapshot writer to populate new columns using the existing `getHoldingCardPlacement()` rules
- Update analytics measures + standard views to read new columns
- Update analytics UI labels (KpiBanner compact map, chart legends via `getMeasureLabel`)
- Update tests

Out of scope (deferred to Phase C-1.5b):
- Migrating the 10 other consumers (Treasury AI, Reporting, Insights, forecast service, rules engine, agent tools/context, claude helper, useTreasury hook, balance-history API) off the old columns
- Dropping the old columns (migration 0050)
- Backfilling historical snapshots (forward-only is fine — analytics is point-in-time)

The dual-write approach means old consumers keep working unchanged; they just don't see MMFs correctly yet. C-1.5b will migrate them deliberately, one at a time.

## Architectural decisions

**Decision 1: Additive migration, dual-write, no backfill.**
- Add new columns to `treasury_state_snapshots` (all nullable initially).
- Writer populates both old AND new columns for the migration window.
- Forward-only: historical snapshots keep their old columns populated but have NULL in new columns. Analytics queries use `COALESCE(new, fallback_from_old_using_best_guess)` where possible, otherwise treat NULL as "unknown, show —".

**Decision 2: New columns, full set.**
```sql
total_bank_base_usd          NUMERIC(36,2) -- bank accounts
total_mmf_base_usd           NUMERIC(36,2) -- yield positions with venue.category = 'tokenized_mmf'
total_stablecoin_idle_base_usd NUMERIC(36,2) -- idle USDC/USDT in self-custody wallets
total_defi_positions_base_usd  NUMERIC(36,2) -- yield positions with DeFi category
total_other_base_usd         NUMERIC(36,2) -- non-stable wallet tokens + unknown venues
```
Cash = `total_bank_base_usd + total_mmf_base_usd` (computed at read time, not stored).

**Decision 3: Keep `total_value_base_usd` unchanged.**
Total treasury keeps the same definition (sum of everything). Writers ensure the new bucket sum equals the old bucket sum equals `total_value_base_usd`.

**Decision 4: Don't rename existing columns.**
Renames break the 10 unmigrated consumers. Additive path is safer.

## Testing strategy

- Writer unit test (vitest): given a mock positions input with bank + MMF yield + idle stablecoin + DeFi yield + misc wallet token, assert each bucket column sums correctly.
- Measures resolver test: verify the analytics resolver reads new columns and sums correctly.
- Manual smoke: load `/analytics`, verify KpiBanner shows Bank / MMFs / Stablecoins / DeFi / Other with values that match the Treasury AI overview.
- tsc + full vitest green.

---

# Task 1: Migration 0049 — new segmentation columns

**Files:** Create `supabase/migrations/0049_treasury_segmentation_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 0049_treasury_segmentation_columns.sql
-- Add UX-model-aligned aggregate columns to treasury_state_snapshots.
-- Old columns (total_fiat_base_usd, total_stablecoin_base_usd,
-- total_defi_base_usd) stay in place for this migration window;
-- consumers migrate one-by-one in C-1.5b, then old columns drop.
-- ============================================================

ALTER TABLE treasury_state_snapshots
  ADD COLUMN IF NOT EXISTS total_bank_base_usd             NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_mmf_base_usd              NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_stablecoin_idle_base_usd  NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_defi_positions_base_usd   NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_other_base_usd            NUMERIC(36,2);

COMMENT ON COLUMN treasury_state_snapshots.total_bank_base_usd            IS 'Bank account balances (off-chain). Part of Cash.';
COMMENT ON COLUMN treasury_state_snapshots.total_mmf_base_usd             IS 'Tokenized money-market-fund positions (yield positions with venue.category = tokenized_mmf). Part of Cash.';
COMMENT ON COLUMN treasury_state_snapshots.total_stablecoin_idle_base_usd IS 'Idle USDC/USDT balances in self-custody wallets (NOT deployed).';
COMMENT ON COLUMN treasury_state_snapshots.total_defi_positions_base_usd  IS 'Yield positions in DeFi venues (Aave/Compound/Morpho/Kamino/etc).';
COMMENT ON COLUMN treasury_state_snapshots.total_other_base_usd           IS 'Fallback: non-stable wallet tokens (ETH/SOL/etc) and unknown yield venues.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to dev**

```bash
export $(grep -v '^#' .env.local | xargs) 2>/dev/null
npx tsx scripts/migrate.ts supabase/migrations/0049_treasury_segmentation_columns.sql
```

Expected: migration applies, 5 new columns exist on `treasury_state_snapshots`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0049_treasury_segmentation_columns.sql
git commit -m "feat(treasury): add UX-aligned segmentation columns (migration 0049)"
```

---

# Task 2: Refactor snapshot writer to dual-write

**Files:** Modify `src/lib/treasury/state/service.ts`, `src/lib/treasury/state/types.ts`

- [ ] **Step 1: Add new fields to TreasuryStateSnapshot type**

In `src/lib/treasury/state/types.ts`, add to the interface:

```typescript
totalBankBaseUsd: number;
totalMmfBaseUsd: number;
totalStablecoinIdleBaseUsd: number;
totalDefiPositionsBaseUsd: number;
totalOtherBaseUsd: number;
```

Keep the three old fields (`totalFiatBaseUsd`, `totalStablecoinBaseUsd`, `totalDefiBaseUsd`) in the interface.

- [ ] **Step 2: Import the categorization helper**

In `src/lib/treasury/state/service.ts`:

```typescript
import { getHoldingCardPlacement } from '@/lib/treasury/holdings-category';
import { getVenue } from '@/lib/yield/venues';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';
```

- [ ] **Step 3: Compute new buckets in computeSnapshot**

Replace the old bucket reduction block (around line 219) with:

```typescript
// Old aggregate columns — kept for backwards-compat during migration window
const totalFiatBaseUsd = bankAccounts.reduce((a, b) => a + b.balanceBaseUsd, 0);
const totalStablecoinBaseUsd = wallets.reduce((a, b) => a + b.balanceBaseUsd, 0);
const totalDefiBaseUsd = defiPositions.reduce((a, b) => a + b.currentValueBaseUsd, 0);

// New UX-aligned buckets — see src/lib/treasury/holdings-category.ts
const totalBankBaseUsd = bankAccounts.reduce((a, b) => a + b.balanceBaseUsd, 0);

let totalMmfBaseUsd = 0;
let totalDefiPositionsBaseUsd = 0;
let totalYieldOtherUsd = 0;
for (const p of defiPositions) {
  const placement = getHoldingCardPlacement({
    kind: 'yield_position',
    protocol: p.protocol as YieldProtocolId,
  });
  if (placement === 'cash') totalMmfBaseUsd += p.currentValueBaseUsd;
  else if (placement === 'defi_positions') totalDefiPositionsBaseUsd += p.currentValueBaseUsd;
  else totalYieldOtherUsd += p.currentValueBaseUsd;
}

let totalStablecoinIdleBaseUsd = 0;
let totalWalletOtherUsd = 0;
for (const w of wallets) {
  const placement = getHoldingCardPlacement({
    kind: 'wallet_balance',
    token: w.token as TokenSymbol,
  });
  if (placement === 'stablecoin') totalStablecoinIdleBaseUsd += w.balanceBaseUsd;
  else totalWalletOtherUsd += w.balanceBaseUsd;
}

const totalOtherBaseUsd = totalYieldOtherUsd + totalWalletOtherUsd;

const totalValueBaseUsd =
  totalBankBaseUsd + totalMmfBaseUsd + totalStablecoinIdleBaseUsd +
  totalDefiPositionsBaseUsd + totalOtherBaseUsd;
```

**Invariant check:** the new bucket sum should equal `totalFiatBaseUsd + totalStablecoinBaseUsd + totalDefiBaseUsd` (old sum). Assert this in a dev-only log for sanity.

- [ ] **Step 4: Pass new fields through the return value**

```typescript
return {
  enterpriseId,
  takenBy: null,
  trigger,
  baseCurrency: 'USD',
  totalValueBaseUsd,
  totalFiatBaseUsd,
  totalStablecoinBaseUsd,
  totalDefiBaseUsd,
  totalBankBaseUsd,
  totalMmfBaseUsd,
  totalStablecoinIdleBaseUsd,
  totalDefiPositionsBaseUsd,
  totalOtherBaseUsd,
  positions,
  fxRates,
};
```

- [ ] **Step 5: Persist new columns**

In `persistSnapshot`, add to the `.insert({ ... })` block:

```typescript
total_bank_base_usd: snap.totalBankBaseUsd,
total_mmf_base_usd: snap.totalMmfBaseUsd,
total_stablecoin_idle_base_usd: snap.totalStablecoinIdleBaseUsd,
total_defi_positions_base_usd: snap.totalDefiPositionsBaseUsd,
total_other_base_usd: snap.totalOtherBaseUsd,
```

- [ ] **Step 6: Read new columns in latest()**

```typescript
totalBankBaseUsd: num(data.total_bank_base_usd),
totalMmfBaseUsd: num(data.total_mmf_base_usd),
totalStablecoinIdleBaseUsd: num(data.total_stablecoin_idle_base_usd),
totalDefiPositionsBaseUsd: num(data.total_defi_positions_base_usd),
totalOtherBaseUsd: num(data.total_other_base_usd),
```

- [ ] **Step 7: Update the `.select(...)` column list in latest()**

Make sure the SELECT pulls the new columns.

- [ ] **Step 8: Verify tsc**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/treasury/state/service.ts src/lib/treasury/state/types.ts
git commit -m "feat(treasury): dual-write new segmentation buckets in snapshot writer"
```

---

# Task 3: Writer unit test

**Files:** Create `tests/treasury/state/service.segmentation.test.ts`

- [ ] **Step 1: Write the test**

Test shape:
- Mock a `TreasuryStateService` with seeded bank + wallet (USDC, USDT, ETH) + yield positions (tokenized MMF + DeFi)
- Run `computeSnapshot`
- Assert each new bucket column sums correctly
- Assert the invariant: sum of new buckets === sum of old buckets === `totalValueBaseUsd`

- [ ] **Step 2: Run**

```bash
npx vitest run tests/treasury/state/service.segmentation.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/treasury/state/service.segmentation.test.ts
git commit -m "test(treasury): segmentation bucket sums in snapshot writer"
```

---

# Task 4: New analytics measures

**Files:** Modify `src/lib/analytics/measures.ts`

- [ ] **Step 1: Add new measure definitions**

Add to the `MEASURES` array, alongside (NOT replacing) the old fiat/stablecoin/defi measures:

```typescript
{
  slug: 'bank_balance_usd',
  label: 'Bank Balance',
  description: 'Off-chain bank account balances in USD',
  unit: 'usd',
  source: {
    table: 'treasury_state_snapshots',
    valueColumn: 'total_bank_base_usd',
    dateColumn: 'taken_at',
    enterpriseColumn: 'enterprise_id',
    aggregation: 'latest',
  },
  dimensions: ['time'],
},
{
  slug: 'mmf_balance_usd',
  label: 'MMF Balance',
  description: 'Tokenized money market fund positions in USD',
  unit: 'usd',
  source: {
    table: 'treasury_state_snapshots',
    valueColumn: 'total_mmf_base_usd',
    dateColumn: 'taken_at',
    enterpriseColumn: 'enterprise_id',
    aggregation: 'latest',
  },
  dimensions: ['time'],
},
{
  slug: 'cash_balance_usd',
  label: 'Cash',
  description: 'Bank + tokenized MMFs (cash-equivalent balances) in USD',
  unit: 'usd',
  computed: true, // resolver sums bank + mmf
  dimensions: ['time'],
},
{
  slug: 'stablecoin_idle_balance_usd',
  label: 'Stablecoins',
  description: 'Idle USDC/USDT balances in self-custody wallets',
  unit: 'usd',
  source: {
    table: 'treasury_state_snapshots',
    valueColumn: 'total_stablecoin_idle_base_usd',
    dateColumn: 'taken_at',
    enterpriseColumn: 'enterprise_id',
    aggregation: 'latest',
  },
  dimensions: ['time'],
},
{
  slug: 'defi_positions_usd',
  label: 'DeFi Positions',
  description: 'Yield positions in DeFi venues (Aave, Compound, Morpho, Kamino, etc.) in USD',
  unit: 'usd',
  source: {
    table: 'treasury_state_snapshots',
    valueColumn: 'total_defi_positions_base_usd',
    dateColumn: 'taken_at',
    enterpriseColumn: 'enterprise_id',
    aggregation: 'latest',
  },
  dimensions: ['time'],
},
{
  slug: 'other_balance_usd',
  label: 'Other',
  description: 'Non-stable wallet tokens and unknown yield venues in USD',
  unit: 'usd',
  source: {
    table: 'treasury_state_snapshots',
    valueColumn: 'total_other_base_usd',
    dateColumn: 'taken_at',
    enterpriseColumn: 'enterprise_id',
    aggregation: 'latest',
  },
  dimensions: ['time'],
},
```

**Leave the old fiat/stablecoin/defi measures in place.** Other consumers (not this plan) still reference them. They'll be deprecated in C-1.5b.

- [ ] **Step 2: Commit**

```bash
git add src/lib/analytics/measures.ts
git commit -m "feat(analytics): add UX-aligned treasury segmentation measures"
```

---

# Task 5: Update the treasury resolver

**Files:** Modify `src/lib/analytics/resolvers/treasury.ts`

- [ ] **Step 1: Handle the new computed measure (cash_balance_usd)**

Currently the resolver builds `fiat_balance_usd`, `stablecoin_balance_usd`, `defi_balance_usd` from the snapshot. Add a parallel path that reads `total_bank_base_usd` + `total_mmf_base_usd` + `total_stablecoin_idle_base_usd` + `total_defi_positions_base_usd` + `total_other_base_usd` and exposes them as the new measure slugs. `cash_balance_usd` = bank + mmf.

- [ ] **Step 2: Extend the `.select(...)` column list to include new columns**

- [ ] **Step 3: Verify tsc + run tests**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
npx vitest run tests/analytics/
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/resolvers/treasury.ts
git commit -m "feat(analytics): resolver reads new segmentation columns"
```

---

# Task 6: Swap standard views to new measures

**Files:** Modify `src/lib/analytics/standard-views.ts`

- [ ] **Step 1: Update Treasury Summary**

```typescript
// BEFORE
measures: ['total_balance_usd', 'fiat_balance_usd', 'stablecoin_balance_usd', 'defi_balance_usd', 'idle_cash_usd', 'coverage_ratio']

// AFTER
measures: ['total_balance_usd', 'cash_balance_usd', 'stablecoin_idle_balance_usd', 'defi_positions_usd', 'other_balance_usd', 'coverage_ratio']
```

- [ ] **Step 2: Update Balance History**

```typescript
// BEFORE
measures: ['fiat_balance_usd', 'stablecoin_balance_usd', 'defi_balance_usd']

// AFTER
measures: ['bank_balance_usd', 'mmf_balance_usd', 'stablecoin_idle_balance_usd', 'defi_positions_usd']
```

Shows the five leaf buckets as separate lines — treasurer can see Bank, MMFs, idle Stablecoins, DeFi, Other separately.

- [ ] **Step 3: Update Obligation Coverage view**

```typescript
// BEFORE
measures: ['obligation_total_usd', 'fiat_balance_usd', 'coverage_ratio']

// AFTER
measures: ['obligation_total_usd', 'cash_balance_usd', 'coverage_ratio']
```

Cash (not just bank) is what covers obligations.

- [ ] **Step 4: Update Idle Cash view** (if references old slugs — verify)

- [ ] **Step 5: Verify tsc + vitest**

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics/standard-views.ts
git commit -m "feat(analytics): standard views switch to UX-aligned measures"
```

---

# Task 7: KpiBanner compact label map

**Files:** Modify `src/components/analytics/KpiBanner.tsx`

- [ ] **Step 1: Update the LABELS map**

```typescript
const LABELS: Record<string, string> = {
  total_balance_usd: 'Total Balance',
  cash_balance_usd: 'Cash',
  bank_balance_usd: 'Bank',
  mmf_balance_usd: 'MMFs',
  stablecoin_idle_balance_usd: 'Stablecoins',
  defi_positions_usd: 'DeFi',
  other_balance_usd: 'Other',
  idle_cash_usd: 'Idle Cash',
  coverage_ratio: 'Coverage',
  // Keep old slugs for backwards-compat while other consumers are unmigrated
  fiat_balance_usd: 'Bank', // deprecated alias — reads stay accurate
  stablecoin_balance_usd: 'Stablecoins',
  defi_balance_usd: 'DeFi',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/KpiBanner.tsx
git commit -m "style(analytics): KpiBanner labels follow bank/wallet vocab"
```

---

# Task 8: Update export-helpers test fixtures

**Files:** Modify `tests/analytics/export-helpers.test.ts`

- [ ] **Step 1: Update the KPI fixture to use new slugs**

Replace `fiat_balance_usd` in the fixture with `bank_balance_usd`, adjust expected header from "Fiat Balance" to "Bank Balance" (from `getMeasureLabel`).

- [ ] **Step 2: Run and verify**

```bash
npx vitest run tests/analytics/export-helpers.test.ts
```

---

# Task 9: Architecture doc update

**Files:** Modify `docs/architecture/forecast-analytics.md`

- [ ] **Step 1: Append Phase C-1.5 section**

Explain the new columns, the dual-write, the mapping, the C-1.5b plan to drop old columns.

- [ ] **Step 2: Commit**

---

# Task 10: Full verification + apply migration + PR

- [ ] **Step 1: Full tsc + vitest**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
npx vitest run
```

- [ ] **Step 2: Trigger a fresh snapshot for the test enterprise**

In dev, hit whatever endpoint triggers `TreasuryStateService.computeSnapshot()` for the test enterprise (e.g. via the cron runner, or the operations trigger on the app). Verify the new row in `treasury_state_snapshots` has non-null values for the 5 new columns and the invariant holds.

- [ ] **Step 3: Smoke-test the UI**

Start dev server, navigate to `/analytics`, verify:
- Treasury Summary banner shows Cash / Stablecoins / DeFi / Other (or Bank / MMFs separately, depending on the slug split chosen in Task 6 Step 1)
- Balance History chart legend shows "Bank Balance" / "MMF Balance" / "Stablecoins" / "DeFi Positions"
- MMF positions contribute to the Cash number, NOT DeFi

- [ ] **Step 4: Apply migration 0049 to prod**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://lfujbwemavgiifkltrag.supabase.co npx tsx scripts/migrate.ts supabase/migrations/0049_treasury_segmentation_columns.sql
```

- [ ] **Step 5: Merge to master**

```bash
cd C:/Users/John/crypto-treasury
git fetch origin master
cd .worktrees/treasury-segmentation
git pull --rebase origin master
# resolve any conflicts
cd ..
git merge --ff-only feature/treasury-segmentation
git push origin master
```

- [ ] **Step 6: Kill worktree**

```bash
git worktree remove --force .worktrees/treasury-segmentation
git branch -d feature/treasury-segmentation
```

- [ ] **Step 7: Update memory**

Write `project_treasury_segmentation_c15a_shipped.md`, update `MEMORY.md` index. Queue `project_treasury_segmentation_c15b_ready.md` for the consumer-migration + drop-old-columns pass.

---

## Summary

**10 tasks.** Narrowly scoped: make MMFs + correct segmentation visible on `/analytics` without breaking the 10 other consumers that still read the old columns. Dual-write + additive columns means zero risk to existing features.

**C-1.5b follow-up (separate plan):**
- Migrate Treasury AI overview, Report Builder sections, Insights detectors, forecast service, rules engine, agent tools, agent context, claude helper, useTreasury hook, balance-history API to new columns.
- Drop old columns in migration 0050.
- Drop dual-write from snapshot writer.
