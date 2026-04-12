# Treasury Segmentation Alignment — Implementation Plan (Phase C-1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the DB-vs-UX segmentation mismatch so Vantor's actual treasury taxonomy — Cash & Equivalents vs Yield Positions, with MMFs and DeFi Vaults and DeFi Lending as distinct leaves — is reflected in the snapshot schema, analytics measures, and analytics UI. Kill the "fiat" vocabulary.

**Branch:** `feature/treasury-segmentation` (worktree at `.worktrees/treasury-segmentation`)

**Context notes:**
- `project_treasury_segmentation_mismatch.md` — original problem statement
- `feedback_vantor_bank_wallet_vocab.md` — vocabulary rules (bank/wallet, never "fiat")
- `feedback_vantor_stablecoin_vocab.md` — always "stablecoin", never "crypto"

---

## The canonical Vantor treasury taxonomy

```
Total Treasury
├── Cash & Equivalents                (L1 — rollup)
│   ├── Cash                          (L2 — leaf)
│   │   └── Bank balances, multi-currency (USD, GBP, EUR, MXN, BRL, …)
│   └── Stablecoins                   (L2 — leaf)
│       └── Idle USDC, USDT in self-custody wallets (NOT deployed)
└── Yield Positions                   (L1 — rollup)
    ├── Tokenized MMFs                (L2 — leaf)
    │   └── Spiko (USD/EUR), BlackRock BUIDL, Hashnote USYC, Ondo USDY, …
    └── DeFi Protocols                (L2 — rollup)
        ├── DeFi Vault Protocols      (L3 — leaf)
        │   └── Kamino Multiply, Morpho Reservoir USDC, Morpho Steakhouse, …
        └── DeFi Lending Protocols    (L3 — leaf)
            └── Aave V3, Compound V3, Kamino Lend, …
(Other — catch-all: ETH/SOL/misc wallet tokens, unrecognized venues.)
```

**L3 leaves** are what the snapshot writer persists. Everything above is computed at read time.

**Multi-currency note:** Cash and MMFs both span multiple denomination currencies (USD bank account + EUR bank account; USD BUIDL + EUR Spiko). The per-position currency lives in the source tables (`bank_accounts.currency`, `yield_positions` joined to the venue registry). Aggregate columns always store USD-base using snapshot-time FX. Per-denomination breakdown is recoverable from the `positions` JSONB without schema changes.

## What's in scope for Phase C-1.5a (this plan)

- Migration 0049: add 6 leaf columns on `treasury_state_snapshots`
- `holdings-category.ts` — add `getHoldingTaxonomy()` that returns the new 6-leaf placement; keep the old `getHoldingCardPlacement()` as a deprecated alias so other consumers don't break
- Snapshot writer — populate new columns using `getHoldingTaxonomy()`, keep dual-write on old columns
- 6 new leaf measures + 3 new rollup measures in `measures.ts`
- Update the 3 analytics standard views to use the new measures at the right granularity
- Update analytics UI labels (KpiBanner, via `getMeasureLabel`)
- Tests

## What's out of scope (Phase C-1.5b)

- Migrating 10 other consumers (Treasury AI overview, Report Builder, Insights, forecast service, rules engine, agent tools/context, claude helper, useTreasury hook, balance-history API) to the new columns
- Dropping old columns in migration 0050
- Removing dual-write in writer
- UI label sweep across Treasury AI, Report Builder, etc.

The dual-write + additive-columns path means Phase C-1.5a ships without breaking any of those downstream. They keep reading old columns with old (wrong) MMF placement until individually migrated.

## Architectural decisions

**D1. Additive migration, dual-write, no backfill.** Forward-only. Historical snapshots keep old columns populated; new columns are NULL on pre-migration rows. Analytics resolver handles NULLs gracefully (show `—` for missing snapshot).

**D2. Persist L3 leaves only; compute rollups at read time.** Single source of truth — no risk of leaf/rollup drift. Rollups live in measure resolvers.

**D3. Taxonomy helper added to `holdings-category.ts`, old API preserved.**
```typescript
export type HoldingTaxonomy =
  | 'cash'           // bank balances
  | 'stablecoin'     // idle USDC/USDT in wallets
  | 'mmf'            // tokenized money-market funds
  | 'defi_vault'     // DeFi vault protocols
  | 'defi_lending'   // DeFi lending protocols
  | 'other';         // fallback

export function getHoldingTaxonomy(holding: HoldingForCategorization): HoldingTaxonomy;
```
The old `getHoldingCardPlacement()` stays, returning the 4-bucket model for backwards-compat with 10 unmigrated consumers. Internally it can delegate to `getHoldingTaxonomy()` and collapse mmf→cash / defi_vault|defi_lending→defi_positions.

**D4. Don't rename existing columns.** Renames break 10 unmigrated consumers. Additive path.

**D5. Extensibility.** Per-currency MMF breakdown (USD vs EUR-denominated) does NOT need schema changes. The `positions` JSONB column already captures per-position denomination via the venue registry. Analytics can add a `denomination` dimension in a future measure without touching `treasury_state_snapshots`.

## Testing strategy

- Writer unit test (vitest): mocked positions → assert each of the 6 leaf buckets sums correctly + invariant (new bucket sum === old bucket sum === total_value_base_usd).
- Taxonomy function test: each category-to-placement mapping.
- Measures resolver test: assert rollup measures compute correctly from leaves.
- Manual smoke on /analytics once dev snapshot is regenerated.

---

# Task 1: Migration 0049 — six leaf columns

**Files:** Create `supabase/migrations/0049_treasury_segmentation_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 0049_treasury_segmentation_columns.sql
-- Add UX-aligned L3-leaf aggregate columns to treasury_state_snapshots.
-- Old columns (total_fiat_base_usd, total_stablecoin_base_usd,
-- total_defi_base_usd) stay in place for this migration window;
-- consumers migrate one-by-one in Phase C-1.5b, then old columns drop.
-- ============================================================

ALTER TABLE treasury_state_snapshots
  ADD COLUMN IF NOT EXISTS total_bank_base_usd             NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_stablecoin_idle_base_usd  NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_mmf_base_usd              NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_defi_vault_base_usd       NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_defi_lending_base_usd     NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS total_other_base_usd            NUMERIC(36,2);

COMMENT ON COLUMN treasury_state_snapshots.total_bank_base_usd            IS 'L3 leaf: bank account balances (off-chain, multi-currency converted to USD base). Rolls up into Cash & Equivalents.';
COMMENT ON COLUMN treasury_state_snapshots.total_stablecoin_idle_base_usd IS 'L3 leaf: idle USDC/USDT in self-custody wallets (NOT deployed). Rolls up into Cash & Equivalents.';
COMMENT ON COLUMN treasury_state_snapshots.total_mmf_base_usd             IS 'L3 leaf: tokenized money-market-fund positions (Spiko, BUIDL, USYC, Ondo USDY, etc.). Rolls up into Yield Positions.';
COMMENT ON COLUMN treasury_state_snapshots.total_defi_vault_base_usd      IS 'L3 leaf: DeFi vault protocol positions (Kamino Multiply, Morpho Reservoir, Morpho Steakhouse, etc.). Rolls up into DeFi Protocols → Yield Positions.';
COMMENT ON COLUMN treasury_state_snapshots.total_defi_lending_base_usd    IS 'L3 leaf: DeFi lending protocol positions (Aave V3, Compound V3, Kamino Lend). Rolls up into DeFi Protocols → Yield Positions.';
COMMENT ON COLUMN treasury_state_snapshots.total_other_base_usd           IS 'Fallback: non-stable wallet tokens (ETH/SOL/etc) and unknown yield venues.';

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to dev**

```bash
export $(grep -v '^#' .env.local | xargs) 2>/dev/null
npx tsx scripts/migrate.ts supabase/migrations/0049_treasury_segmentation_columns.sql
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0049_treasury_segmentation_columns.sql
git commit -m "feat(treasury): add L3-leaf segmentation columns (migration 0049)"
```

---

# Task 2: Taxonomy helper in holdings-category

**Files:** Modify `src/lib/treasury/holdings-category.ts`

- [ ] **Step 1: Add HoldingTaxonomy type + function**

Add near the existing `CardPlacement` type:

```typescript
/**
 * Full Vantor treasury taxonomy — L3 leaves. Where `getHoldingCardPlacement`
 * collapses to 4 display buckets, this function returns the structural
 * category a holding belongs to in the canonical taxonomy:
 *
 *   Cash & Equivalents  → 'cash' | 'stablecoin'
 *   Yield Positions     → 'mmf' | 'defi_vault' | 'defi_lending'
 *   (catch-all)         → 'other'
 *
 * Used by the snapshot writer to populate the L3-leaf aggregate columns
 * on `treasury_state_snapshots`. Consumers that don't need vault vs lending
 * distinction can keep using `getHoldingCardPlacement`.
 */
export type HoldingTaxonomy =
  | 'cash'
  | 'stablecoin'
  | 'mmf'
  | 'defi_vault'
  | 'defi_lending'
  | 'other';

export function getHoldingTaxonomy(
  holding: HoldingForCategorization,
): HoldingTaxonomy {
  switch (holding.kind) {
    case 'bank_balance':
      return 'cash';
    case 'wallet_balance':
      return STABLECOIN_TOKENS.has(holding.token) ? 'stablecoin' : 'other';
    case 'yield_position': {
      const venue = getVenue(holding.protocol);
      if (!venue) return 'other';
      if (venue.category === 'tokenized_mmf') return 'mmf';
      if (venue.category === 'defi_vault') return 'defi_vault';
      if (venue.category === 'defi_lending_market') return 'defi_lending';
      return 'other';
    }
  }
}
```

- [ ] **Step 2: (Optional) Refactor getHoldingCardPlacement to delegate**

To prevent drift, rewrite `getHoldingCardPlacement` as:

```typescript
export function getHoldingCardPlacement(
  holding: HoldingForCategorization,
): CardPlacement {
  const tax = getHoldingTaxonomy(holding);
  switch (tax) {
    case 'cash':
    case 'mmf':        // MMFs are cash-equivalents in the 4-bucket card model
      return 'cash';
    case 'stablecoin':
      return 'stablecoin';
    case 'defi_vault':
    case 'defi_lending':
      return 'defi_positions';
    case 'other':
      return 'other';
  }
}
```

This preserves existing 4-bucket behavior for unmigrated consumers.

- [ ] **Step 3: Update comment at top of file**

Note the new taxonomy and that `getHoldingCardPlacement` is now a rollup view of it.

- [ ] **Step 4: Unit test for getHoldingTaxonomy**

Create `tests/treasury/holdings-category-taxonomy.test.ts` covering:
- bank → cash
- USDC / USDT wallet → stablecoin
- ETH / SOL wallet → other
- yield position with category tokenized_mmf → mmf
- yield position with category defi_vault → defi_vault
- yield position with category defi_lending_market → defi_lending
- yield position with unknown venue → other

- [ ] **Step 5: Verify tsc + test**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
npx vitest run tests/treasury/holdings-category-taxonomy.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/treasury/holdings-category.ts tests/treasury/holdings-category-taxonomy.test.ts
git commit -m "feat(treasury): add getHoldingTaxonomy (L3-leaf classifier)"
```

---

# Task 3: Snapshot writer dual-write

**Files:** Modify `src/lib/treasury/state/service.ts`, `src/lib/treasury/state/types.ts`

- [ ] **Step 1: Add fields to TreasuryStateSnapshot type**

In `types.ts`:
```typescript
totalBankBaseUsd: number;
totalStablecoinIdleBaseUsd: number;
totalMmfBaseUsd: number;
totalDefiVaultBaseUsd: number;
totalDefiLendingBaseUsd: number;
totalOtherBaseUsd: number;
```

Keep old fields (`totalFiatBaseUsd`, `totalStablecoinBaseUsd`, `totalDefiBaseUsd`).

- [ ] **Step 2: Compute L3 leaves in computeSnapshot**

Import:
```typescript
import { getHoldingTaxonomy } from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';
```

Replace the bucket reduction block (around line 219) with:

```typescript
// Leaf buckets — see holdings-category.ts taxonomy.
let totalBankBaseUsd = 0;
let totalStablecoinIdleBaseUsd = 0;
let totalMmfBaseUsd = 0;
let totalDefiVaultBaseUsd = 0;
let totalDefiLendingBaseUsd = 0;
let totalOtherBaseUsd = 0;

for (const b of bankAccounts) {
  totalBankBaseUsd += b.balanceBaseUsd;
}

for (const w of wallets) {
  const tax = getHoldingTaxonomy({
    kind: 'wallet_balance',
    token: w.token as TokenSymbol,
  });
  if (tax === 'stablecoin') totalStablecoinIdleBaseUsd += w.balanceBaseUsd;
  else totalOtherBaseUsd += w.balanceBaseUsd;
}

for (const p of defiPositions) {
  const tax = getHoldingTaxonomy({
    kind: 'yield_position',
    protocol: p.protocol as YieldProtocolId,
  });
  if (tax === 'mmf') totalMmfBaseUsd += p.currentValueBaseUsd;
  else if (tax === 'defi_vault') totalDefiVaultBaseUsd += p.currentValueBaseUsd;
  else if (tax === 'defi_lending') totalDefiLendingBaseUsd += p.currentValueBaseUsd;
  else totalOtherBaseUsd += p.currentValueBaseUsd;
}

// Legacy aggregates — kept for backwards-compat through migration window.
const totalFiatBaseUsd = totalBankBaseUsd;
const totalStablecoinBaseUsd = wallets.reduce((a, b) => a + b.balanceBaseUsd, 0);
const totalDefiBaseUsd = defiPositions.reduce(
  (a, b) => a + b.currentValueBaseUsd,
  0,
);

const totalValueBaseUsd =
  totalBankBaseUsd +
  totalStablecoinIdleBaseUsd +
  totalMmfBaseUsd +
  totalDefiVaultBaseUsd +
  totalDefiLendingBaseUsd +
  totalOtherBaseUsd;

// Invariant: new-model sum must equal legacy sum (catch any taxonomy drift).
if (process.env.NODE_ENV !== 'production') {
  const legacySum = totalFiatBaseUsd + totalStablecoinBaseUsd + totalDefiBaseUsd;
  if (Math.abs(totalValueBaseUsd - legacySum) > 0.01) {
    console.warn(
      `[TreasuryStateService] Taxonomy drift: new=${totalValueBaseUsd}, legacy=${legacySum}`,
    );
  }
}
```

- [ ] **Step 3: Pass new fields through return value**

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
  totalStablecoinIdleBaseUsd,
  totalMmfBaseUsd,
  totalDefiVaultBaseUsd,
  totalDefiLendingBaseUsd,
  totalOtherBaseUsd,
  positions,
  fxRates,
};
```

- [ ] **Step 4: Persist new columns in persistSnapshot**

```typescript
total_bank_base_usd: snap.totalBankBaseUsd,
total_stablecoin_idle_base_usd: snap.totalStablecoinIdleBaseUsd,
total_mmf_base_usd: snap.totalMmfBaseUsd,
total_defi_vault_base_usd: snap.totalDefiVaultBaseUsd,
total_defi_lending_base_usd: snap.totalDefiLendingBaseUsd,
total_other_base_usd: snap.totalOtherBaseUsd,
```

- [ ] **Step 5: Read new columns in latest() — SELECT + mapping**

- [ ] **Step 6: Verify tsc**

- [ ] **Step 7: Commit**

```bash
git add src/lib/treasury/state/service.ts src/lib/treasury/state/types.ts
git commit -m "feat(treasury): dual-write L3-leaf buckets in snapshot writer"
```

---

# Task 4: Writer segmentation test

**Files:** Create `tests/treasury/state/service.segmentation.test.ts`

- [ ] **Step 1: Write the test**

Mock `TreasuryStateService` with:
- 2 bank accounts (USD $100k, EUR €50k → $55k at snapshot FX) → total_bank = $155k
- 3 wallet balances: USDC $10k, USDT $5k, ETH $2k → total_stablecoin_idle = $15k, total_other += $2k
- 3 yield positions: BUIDL $200k (MMF), Kamino Multiply $50k (vault), Aave V3 $75k (lending) → mmf=$200k, vault=$50k, lending=$75k

Assert each bucket. Assert `totalValueBaseUsd` = $497k. Assert invariant `newSum === legacySum`.

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/treasury/state/service.segmentation.test.ts
git add tests/treasury/state/service.segmentation.test.ts
git commit -m "test(treasury): L3-leaf bucket sums + invariant"
```

---

# Task 5: New analytics measures

**Files:** Modify `src/lib/analytics/measures.ts`

- [ ] **Step 1: Add 6 leaf measures**

```typescript
// L3 leaves (backed by snapshot columns)
{
  slug: 'bank_balance_usd',
  label: 'Bank',
  description: 'Off-chain bank account balances (multi-currency, USD base) — L3 leaf of Cash & Equivalents.',
  unit: 'usd',
  source: { table: 'treasury_state_snapshots', valueColumn: 'total_bank_base_usd', dateColumn: 'taken_at', enterpriseColumn: 'enterprise_id', aggregation: 'latest' },
  dimensions: ['time'],
},
{
  slug: 'stablecoin_idle_balance_usd',
  label: 'Stablecoins',
  description: 'Idle USDC/USDT in self-custody wallets — L3 leaf of Cash & Equivalents.',
  unit: 'usd',
  source: { table: 'treasury_state_snapshots', valueColumn: 'total_stablecoin_idle_base_usd', dateColumn: 'taken_at', enterpriseColumn: 'enterprise_id', aggregation: 'latest' },
  dimensions: ['time'],
},
{
  slug: 'mmf_balance_usd',
  label: 'Tokenized MMFs',
  description: 'Tokenized money-market-fund positions (Spiko, BUIDL, USYC, Ondo USDY) — L3 leaf of Yield Positions.',
  unit: 'usd',
  source: { table: 'treasury_state_snapshots', valueColumn: 'total_mmf_base_usd', dateColumn: 'taken_at', enterpriseColumn: 'enterprise_id', aggregation: 'latest' },
  dimensions: ['time'],
},
{
  slug: 'defi_vault_balance_usd',
  label: 'DeFi Vaults',
  description: 'DeFi vault protocol positions (Kamino Multiply, Morpho Reservoir, Morpho Steakhouse) — L3 leaf of DeFi Protocols.',
  unit: 'usd',
  source: { table: 'treasury_state_snapshots', valueColumn: 'total_defi_vault_base_usd', dateColumn: 'taken_at', enterpriseColumn: 'enterprise_id', aggregation: 'latest' },
  dimensions: ['time'],
},
{
  slug: 'defi_lending_balance_usd',
  label: 'DeFi Lending',
  description: 'DeFi lending protocol positions (Aave V3, Compound V3, Kamino Lend) — L3 leaf of DeFi Protocols.',
  unit: 'usd',
  source: { table: 'treasury_state_snapshots', valueColumn: 'total_defi_lending_base_usd', dateColumn: 'taken_at', enterpriseColumn: 'enterprise_id', aggregation: 'latest' },
  dimensions: ['time'],
},
{
  slug: 'other_balance_usd',
  label: 'Other',
  description: 'Non-stable wallet tokens (ETH, SOL, etc.) and unknown yield venues.',
  unit: 'usd',
  source: { table: 'treasury_state_snapshots', valueColumn: 'total_other_base_usd', dateColumn: 'taken_at', enterpriseColumn: 'enterprise_id', aggregation: 'latest' },
  dimensions: ['time'],
},
```

- [ ] **Step 2: Add 3 rollup measures (computed)**

```typescript
// L2 / L1 rollups (computed by resolver)
{
  slug: 'cash_and_equivalents_usd',
  label: 'Cash & Equivalents',
  description: 'Bank + idle stablecoins. Liquid, USD-pegged balances that can settle obligations immediately.',
  unit: 'usd',
  computed: true,
  dimensions: ['time'],
},
{
  slug: 'defi_protocols_usd',
  label: 'DeFi Protocols',
  description: 'DeFi Vaults + DeFi Lending. The deployed DeFi portion of the yield portfolio.',
  unit: 'usd',
  computed: true,
  dimensions: ['time'],
},
{
  slug: 'yield_positions_usd',
  label: 'Yield Positions',
  description: 'Tokenized MMFs + DeFi Protocols. Capital earning a yield.',
  unit: 'usd',
  computed: true,
  dimensions: ['time'],
},
```

- [ ] **Step 3: Keep old fiat/stablecoin/defi measures in place**

Comment them as deprecated — will be removed in C-1.5b once consumers migrate.

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/measures.ts
git commit -m "feat(analytics): L3-leaf + rollup measures for treasury taxonomy"
```

---

# Task 6: Resolver implementation for leaves + rollups

**Files:** Modify `src/lib/analytics/resolvers/treasury.ts`

- [ ] **Step 1: Extend the `.select(...)` column list to include 6 new leaves**

- [ ] **Step 2: Handle all 9 measure slugs (6 leaves + 3 rollups)**

For leaf measures, read the corresponding column directly. For rollups:
- `cash_and_equivalents_usd` = `total_bank_base_usd + total_stablecoin_idle_base_usd`
- `defi_protocols_usd` = `total_defi_vault_base_usd + total_defi_lending_base_usd`
- `yield_positions_usd` = `total_mmf_base_usd + total_defi_vault_base_usd + total_defi_lending_base_usd`

Compute these at resolve time — do NOT store in DB.

- [ ] **Step 3: Handle NULLs from pre-migration snapshots**

If `total_bank_base_usd IS NULL` (snapshot written before migration), treat the leaf value as `null` → resolver returns no data for that point. Do NOT fall back to old columns to derive — that reintroduces the wrong MMF placement silently. Better to show a gap than wrong data.

- [ ] **Step 4: Verify with existing analytics tests**

```bash
npx vitest run tests/analytics/
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/resolvers/treasury.ts
git commit -m "feat(analytics): resolver supports L3 leaves + L1/L2 rollups"
```

---

# Task 7: Standard views use new measures

**Files:** Modify `src/lib/analytics/standard-views.ts`

- [ ] **Step 1: Treasury Summary (KPI)** — switch to rollups at L1

```typescript
measures: [
  'total_balance_usd',
  'cash_and_equivalents_usd',
  'yield_positions_usd',
  'coverage_ratio',
  'idle_cash_usd',
]
```

KpiBanner shows the top-line health of the treasury: total, the two L1 buckets, and coverage. Drill-in to `/analytics/treasury-summary` (or similar) can expose the leaves.

- [ ] **Step 2: Balance History (line)** — L2 detail

```typescript
measures: [
  'cash_and_equivalents_usd',
  'mmf_balance_usd',
  'defi_protocols_usd',
  'other_balance_usd',
]
```

4 lines: Cash & Equivalents (rollup), MMFs (leaf), DeFi Protocols (rollup of vault+lending), Other. Cleaner than 6 lines; users who want vault vs lending can fork.

- [ ] **Step 3: Obligation Coverage (line)**

```typescript
measures: ['obligation_total_usd', 'cash_and_equivalents_usd', 'coverage_ratio']
```

Coverage is measured against Cash & Equivalents (what can actually settle), not all treasury.

- [ ] **Step 4: Check other views** — any remaining references to fiat/stablecoin/defi measures

Likely just `idle_cash` and a few others — audit for the slugs:
```bash
grep -n "fiat_balance_usd\|stablecoin_balance_usd\|defi_balance_usd" src/lib/analytics/standard-views.ts
```

Leave them if they're computed measures based on old slugs (deferred to C-1.5b).

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/standard-views.ts
git commit -m "feat(analytics): standard views use taxonomy-aligned measures"
```

---

# Task 8: KpiBanner label map

**Files:** Modify `src/components/analytics/KpiBanner.tsx`

- [ ] **Step 1: Update LABELS**

```typescript
const LABELS: Record<string, string> = {
  total_balance_usd: 'Total',
  // L1 rollups
  cash_and_equivalents_usd: 'Cash & Equivalents',
  yield_positions_usd: 'Yield Positions',
  // L2 detail
  bank_balance_usd: 'Bank',
  stablecoin_idle_balance_usd: 'Stablecoins',
  mmf_balance_usd: 'MMFs',
  defi_protocols_usd: 'DeFi',
  // L3 leaf detail
  defi_vault_balance_usd: 'DeFi Vaults',
  defi_lending_balance_usd: 'DeFi Lending',
  other_balance_usd: 'Other',
  // Misc
  idle_cash_usd: 'Idle Cash',
  coverage_ratio: 'Coverage',
  // Deprecated aliases (kept until consumers migrate)
  fiat_balance_usd: 'Bank',
  stablecoin_balance_usd: 'Stablecoins',
  defi_balance_usd: 'DeFi',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/KpiBanner.tsx
git commit -m "style(analytics): KpiBanner labels use canonical taxonomy"
```

---

# Task 9: Export-helpers fixtures

**Files:** Modify `tests/analytics/export-helpers.test.ts`

- [ ] **Step 1: Update fixtures to new slugs**

The KPI test fixture uses `fiat_balance_usd` — replace with `cash_and_equivalents_usd` and `mmf_balance_usd`. Update expected header strings accordingly via `getMeasureLabel`.

- [ ] **Step 2: Run + commit**

```bash
npx vitest run tests/analytics/export-helpers.test.ts
git add tests/analytics/export-helpers.test.ts
git commit -m "test(analytics): export-helpers fixtures use taxonomy measures"
```

---

# Task 10: Architecture doc update

**Files:** Modify `docs/architecture/forecast-analytics.md`

- [ ] **Step 1: Append Phase C-1.5a section**

Document:
- The canonical taxonomy (same tree as the top of this plan)
- New 6-leaf schema + 3 rollup measures
- Dual-write strategy and migration window
- What's still on old columns (list consumers) and the C-1.5b plan

- [ ] **Step 2: Commit**

---

# Task 11: Full verification + apply prod + merge

- [ ] **Step 1: tsc + full vitest**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
npx vitest run
```

- [ ] **Step 2: Trigger fresh dev snapshot**

Run the treasury state rebuilder for the test enterprise (whatever endpoint/cron is wired) so new rows have L3 leaves populated. Verify by querying:
```sql
SELECT taken_at, total_bank_base_usd, total_stablecoin_idle_base_usd,
       total_mmf_base_usd, total_defi_vault_base_usd,
       total_defi_lending_base_usd, total_other_base_usd,
       total_value_base_usd
FROM treasury_state_snapshots
ORDER BY taken_at DESC LIMIT 3;
```

Confirm sum of leaves === `total_value_base_usd`.

- [ ] **Step 3: Smoke-test /analytics**

- Treasury Summary shows Cash & Equivalents + Yield Positions + Total + Coverage (4 values)
- Balance History shows 4 lines with canonical labels
- MMF positions contribute to Yield Positions (NOT DeFi); contribute $0 to Cash & Equivalents
- Fork modal lets users pick finer-grained measures (leaves)

- [ ] **Step 4: Apply migration 0049 to prod**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://lfujbwemavgiifkltrag.supabase.co npx tsx scripts/migrate.ts supabase/migrations/0049_treasury_segmentation_columns.sql
```

- [ ] **Step 5: Rebase + merge + push**

```bash
cd .worktrees/treasury-segmentation
git fetch origin master
git pull --rebase origin master
# resolve conflicts
cd C:/Users/John/crypto-treasury
git merge --ff-only feature/treasury-segmentation
git push origin master
```

- [ ] **Step 6: Kill worktree + branch**

```bash
git worktree remove --force .worktrees/treasury-segmentation
git branch -d feature/treasury-segmentation
```

- [ ] **Step 7: Update memory**

Write `project_treasury_segmentation_c15a_shipped.md`. Queue `project_treasury_segmentation_c15b_ready.md` with the 10-consumer migration checklist.

---

## Summary

**11 tasks.** Scope kept to making the canonical Vantor taxonomy visible on `/analytics` via a safe additive migration + dual-write. Consumer migrations (10 other files) and old-column drop deferred to Phase C-1.5b.

Key structural fixes vs the old plan:
- Stablecoins correctly grouped with Cash (as "Cash & Equivalents"), not as a top-level sibling of Cash
- MMFs correctly under Yield Positions (not Cash)
- DeFi Protocols explicitly split into Vault vs Lending L3 leaves
- Multi-currency Bank / MMFs handled via USD-base aggregates + per-position detail in `positions` JSONB (no schema changes needed for EUR MMFs, etc.)
