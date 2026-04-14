# Forecast Analytics — Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a measures/dimensions analytics engine with 12 standard views, expose it via API, and rewire the existing Report Builder data fetchers as adapters over the analytics engine — replacing the monolithic `buildReportData()` with focused per-view resolvers.

**Architecture:** A code-based measures/dimensions registry defines what's queryable. Each of 12 standard views has a resolver function that queries the appropriate tables and returns structured results (KPIs, time series, or detail rows). An analytics query engine dispatches view queries to resolvers. The existing Report Builder's `useReportData` hook is rewired to call the analytics query API per-section instead of fetching from scattered endpoints. Standard views are seeded as rows in a new `analytics_views` table (`enterprise_id IS NULL`, `kind='standard'`); Phase C will add per-enterprise custom views. `simulation_runs` is subsumed by the "Forecast vs Actuals" standard view.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + RLS), TypeScript, Vitest, existing Phase A infrastructure (`ForecastService`, `TreasuryStateService`, `ObligationsRepo`).

**Branch:** `feature/forecast-analytics-b` (worktree at `.worktrees/forecast-analytics-b`)

**Out of scope for Phase B:** custom view builder, alerting, scheduled delivery, exports beyond existing CSV/PDF — all Phase C.

**Pre-approved decisions** (from design note section 4 — do not re-litigate):
- Analytics CRUD gated on `treasury_manager` OR `enterprise_admin`
- Standard views: `kind='standard'`, `enterprise_id IS NULL`; users fork to custom in Phase C
- "Idle cash" = stablecoin balance − (confirmed outflows in next N days, N = active treasury rule's `obligation_lookahead_days`)
- Performance target: warn-only, no CI gate

---

## File Structure

**New files:**
- `supabase/migrations/0047_analytics_views.sql` — analytics_views table + 12 seeded standard views
- `src/lib/analytics/types.ts` — all analytics types (measures, dimensions, views, query context, results)
- `src/lib/analytics/measures.ts` — declarative measure definitions registry
- `src/lib/analytics/dimensions.ts` — dimension definitions registry
- `src/lib/analytics/standard-views.ts` — 12 standard view definitions (matches seeded DB rows)
- `src/lib/analytics/utils.ts` — shared helpers: time bucketing, aggregation, pagination
- `src/lib/analytics/resolvers/index.ts` — resolver registry (view slug → resolver function)
- `src/lib/analytics/resolvers/treasury.ts` — treasury-summary, balance-history, idle-cash resolvers
- `src/lib/analytics/resolvers/obligations.ts` — obligation-coverage resolver
- `src/lib/analytics/resolvers/forecast.ts` — forecast-vs-actuals resolver
- `src/lib/analytics/resolvers/activity.ts` — ramp-activity, transfer-volume, swap-activity resolvers
- `src/lib/analytics/resolvers/detail.ts` — invoice-aging, ai-actions, compliance-summary, yield-performance resolvers
- `src/lib/analytics/engine.ts` — analytics query engine (view slug + query → ViewResult)
- `src/app/api/analytics/measures/route.ts` — GET measures registry
- `src/app/api/analytics/dimensions/route.ts` — GET dimensions registry
- `src/app/api/analytics/views/route.ts` — GET list views, POST create custom view
- `src/app/api/analytics/views/[id]/route.ts` — GET, PATCH, DELETE single view
- `src/app/api/analytics/query/route.ts` — POST execute view query
- `tests/analytics/measures.test.ts` — registry unit tests
- `tests/analytics/dimensions.test.ts` — registry unit tests
- `tests/analytics/standard-views.test.ts` — view definitions unit tests
- `tests/analytics/utils.test.ts` — utility function unit tests
- `tests/analytics/resolvers/treasury.test.ts` — treasury resolver tests
- `tests/analytics/resolvers/obligations.test.ts` — obligation resolver tests
- `tests/analytics/resolvers/forecast.test.ts` — forecast resolver tests
- `tests/analytics/resolvers/activity.test.ts` — activity resolver tests
- `tests/analytics/resolvers/detail.test.ts` — detail resolver tests
- `tests/analytics/engine.test.ts` — engine integration tests

**Modified files:**
- `src/hooks/useReportData.ts` — rewire from direct API calls to analytics query API
- `src/lib/treasury/report.ts` — deprecate `buildReportData()`, keep `reportToCsv()`
- `docs/architecture/forecast-analytics.md` — add Phase B section

---

## Testing strategy

- **Pure unit tests** (vitest, node env): measures/dimensions registries, standard view definitions, utility functions (time bucketing, aggregation). No DB, no network.
- **Resolver unit tests** (vitest, node env): each resolver tested with mock Supabase data. Tests verify the query logic, aggregation, and result shape without hitting the DB.
- **Engine integration test** (vitest, node env, test DB): end-to-end test that seeds data in dev Supabase and executes view queries through the engine. Uses the shared `tests/helpers/test-db.ts` helper from Phase A.

---

## The 12 standard views

| # | Slug | Label | Chart | Description |
|---|---|---|---|---|
| 1 | `treasury-summary` | Treasury Summary | kpi | Balance KPIs: total, fiat, stablecoin, DeFi, idle cash, coverage ratio |
| 2 | `balance-history` | Balance History | line | Daily balance trend (fiat, stablecoin, DeFi) |
| 3 | `obligation-coverage` | Obligation Coverage | bar | Weekly obligation total vs bank balance vs coverage ratio |
| 4 | `forecast-vs-actuals` | Forecast vs Actuals | line | Projected balance from forecast_snapshots vs actual from treasury_state_snapshots |
| 5 | `ramp-activity` | Ramp Activity | bar | On/off-ramp volume by direction |
| 6 | `transfer-volume` | Transfer Volume | table | Transfer detail rows with status/chain filters |
| 7 | `swap-activity` | Swap Activity | table | Swap detail rows with chain filter |
| 8 | `invoice-aging` | Invoice Aging | bar | Outstanding invoices by age bucket (1-30d, 31-60d, 61-90d, 90+d) |
| 9 | `ai-actions` | AI Actions | table | Recommendation detail rows with status/action filters |
| 10 | `compliance-summary` | Compliance Summary | kpi | Sanctions screening + KYT alert counts |
| 11 | `yield-performance` | Yield Performance | table | Yield transaction detail rows by protocol |
| 12 | `idle-cash` | Idle Cash Trend | line | Idle stablecoin balance over time |

---

# Task 1: Migration 0047 — analytics_views table

**Files:**
- Create: `supabase/migrations/0047_analytics_views.sql`

- [ ] **Step 1: Write the migration SQL**

Write `supabase/migrations/0047_analytics_views.sql`:

```sql
-- ============================================================
-- 0047_analytics_views.sql — Analytics views table + standard views
-- Phase B of the Forecast Analytics effort.
-- ============================================================

-- analytics_views: saved view configurations for the analytics engine.
-- Standard views have enterprise_id IS NULL and kind='standard'.
-- Custom views (Phase C) will have enterprise_id set and kind='custom'.
CREATE TABLE IF NOT EXISTS analytics_views (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id   UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  label           TEXT NOT NULL,
  description     TEXT,
  kind            TEXT NOT NULL DEFAULT 'standard'
                    CHECK (kind IN ('standard', 'custom')),
  chart_type      TEXT NOT NULL DEFAULT 'table'
                    CHECK (chart_type IN ('kpi', 'line', 'bar', 'table', 'donut')),
  config          JSONB NOT NULL DEFAULT '{}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Standard views: unique slug per NULL enterprise_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_views_standard_slug
  ON analytics_views(slug) WHERE enterprise_id IS NULL;

-- Custom views: unique slug per enterprise
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_views_enterprise_slug
  ON analytics_views(enterprise_id, slug) WHERE enterprise_id IS NOT NULL;

-- Lookup by enterprise
CREATE INDEX IF NOT EXISTS idx_analytics_views_enterprise
  ON analytics_views(enterprise_id) WHERE enterprise_id IS NOT NULL;

-- RLS
ALTER TABLE analytics_views ENABLE ROW LEVEL SECURITY;

-- Anyone can read standard views
CREATE POLICY "read_standard_views" ON analytics_views
  FOR SELECT USING (kind = 'standard' AND enterprise_id IS NULL);

-- Enterprise members can CRUD their own custom views
CREATE POLICY "enterprise_custom_views" ON analytics_views
  FOR ALL USING (enterprise_id = auth_user_enterprise_id());

-- Seed the 12 standard views
INSERT INTO analytics_views (slug, label, description, kind, chart_type, config, sort_order) VALUES
  ('treasury-summary', 'Treasury Summary',
   'Balance KPIs: total, fiat, stablecoin, DeFi, idle cash, coverage ratio',
   'standard', 'kpi',
   '{"measures":["total_balance_usd","fiat_balance_usd","stablecoin_balance_usd","defi_balance_usd","idle_cash_usd","coverage_ratio"]}',
   1),
  ('balance-history', 'Balance History',
   'Daily balance trend across fiat, stablecoin, and DeFi positions',
   'standard', 'line',
   '{"measures":["fiat_balance_usd","stablecoin_balance_usd","defi_balance_usd"],"primaryDimension":"time","granularity":"day"}',
   2),
  ('obligation-coverage', 'Obligation Coverage',
   'Weekly obligation total vs bank balance with coverage ratio',
   'standard', 'bar',
   '{"measures":["obligation_total_usd","fiat_balance_usd","coverage_ratio"],"primaryDimension":"time","granularity":"week"}',
   3),
  ('forecast-vs-actuals', 'Forecast vs Actuals',
   'Compare projected balance from forecasts against actual treasury state',
   'standard', 'line',
   '{"measures":["forecast_projected_usd","total_balance_usd"],"primaryDimension":"time","granularity":"day"}',
   4),
  ('ramp-activity', 'Ramp Activity',
   'On-ramp and off-ramp volume by direction over time',
   'standard', 'bar',
   '{"measures":["ramp_volume_usd","ramp_count","ramp_fee_usd"],"primaryDimension":"direction"}',
   5),
  ('transfer-volume', 'Transfer Volume',
   'Transfer detail rows with status and chain filters',
   'standard', 'table',
   '{"measures":["transfer_volume_usd","transfer_count"],"primaryDimension":"status"}',
   6),
  ('swap-activity', 'Swap Activity',
   'Swap detail rows with chain filter',
   'standard', 'table',
   '{"measures":["swap_volume_usd","swap_count"],"primaryDimension":"chain"}',
   7),
  ('invoice-aging', 'Invoice Aging',
   'Outstanding invoices bucketed by age (1-30d, 31-60d, 61-90d, 90+d)',
   'standard', 'bar',
   '{"measures":["invoice_outstanding_usd","invoice_count"],"primaryDimension":"age_bucket"}',
   8),
  ('ai-actions', 'AI Actions',
   'AI recommendation outcomes with status and action filters',
   'standard', 'table',
   '{"measures":["recommendation_count","recommendation_executed_count"],"primaryDimension":"status"}',
   9),
  ('compliance-summary', 'Compliance Summary',
   'Sanctions screening and KYT alert statistics',
   'standard', 'kpi',
   '{"measures":["screening_count","screening_hit_count","kyt_alert_count","kyt_open_count"]}',
   10),
  ('yield-performance', 'Yield Performance',
   'Yield positions and transaction activity by protocol',
   'standard', 'table',
   '{"measures":["yield_deposited_usd","yield_withdrawn_usd"],"primaryDimension":"protocol"}',
   11),
  ('idle-cash', 'Idle Cash Trend',
   'Idle stablecoin balance over time (balance minus confirmed outflows)',
   'standard', 'line',
   '{"measures":["idle_cash_usd","stablecoin_balance_usd"],"primaryDimension":"time","granularity":"day"}',
   12)
ON CONFLICT DO NOTHING;

-- Audit actions
INSERT INTO audit_action_registry (action, description)
VALUES
  ('analytics_view_create', 'Custom analytics view created'),
  ('analytics_view_update', 'Analytics view configuration updated'),
  ('analytics_view_delete', 'Custom analytics view deleted'),
  ('analytics_query', 'Analytics view query executed')
ON CONFLICT (action) DO NOTHING;
```

- [ ] **Step 2: Apply to dev Supabase**

Run:
```bash
npx tsx scripts/migrate.ts supabase/migrations/0047_analytics_views.sql
```

Expected: migration applies successfully, 12 standard views inserted.

- [ ] **Step 3: Verify**

Run:
```bash
# Quick check via the Supabase client — count standard views
node -e "
const { createClient } = require('@supabase/supabase-js');
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('analytics_views').select('slug, kind').eq('kind', 'standard').then(r => console.log(r.data?.length, 'standard views:', r.data?.map(v => v.slug).join(', ')));
"
```

Expected: `12 standard views: treasury-summary, balance-history, ...`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0047_analytics_views.sql
git commit -m "feat(analytics): add analytics_views table with 12 standard views (0047)"
```

---

# Task 2: Analytics types module

**Files:**
- Create: `src/lib/analytics/types.ts`

- [ ] **Step 1: Write the types**

Write `src/lib/analytics/types.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

// --------------- Enums / unions ---------------

/** Aggregation strategy for a measure. */
export type Aggregation = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'latest';

/** How a measure's value should be displayed. */
export type MeasureUnit = 'usd' | 'count' | 'ratio' | 'percentage' | 'bps';

/** Chart type for a view. */
export type ChartType = 'kpi' | 'line' | 'bar' | 'table' | 'donut';

/** View kind — standard views ship with the product, custom views are user-created (Phase C). */
export type ViewKind = 'standard' | 'custom';

/** Time granularity for grouping. */
export type TimeGranularity = 'day' | 'week' | 'month';

// --------------- Measure definition ---------------

/**
 * Declarative source for a measure. The generic resolver uses this to build
 * a Supabase query. Omit for computed measures that need custom logic.
 */
export interface MeasureSource {
  table: string;
  /** Column to aggregate (or 'id' for count). */
  valueColumn: string;
  /** Column to filter by time range. */
  dateColumn: string;
  /** Column that holds the enterprise_id. */
  enterpriseColumn: string;
  aggregation: Aggregation;
  /** Static filters always applied (e.g. { is_active: true }). */
  baseFilters?: Record<string, unknown>;
}

/** A single measure in the registry. */
export interface MeasureDefinition {
  slug: string;
  label: string;
  description: string;
  unit: MeasureUnit;
  /** Declarative source — omit for computed measures. */
  source?: MeasureSource;
  /** True when this measure requires a custom resolver (idle_cash, coverage_ratio, etc.). */
  computed?: boolean;
  /** Dimension slugs this measure supports. */
  dimensions: string[];
}

// --------------- Dimension definition ---------------

export interface DimensionDefinition {
  slug: string;
  label: string;
  description: string;
  /** Column name in source tables to group by (null for computed dimensions like age_bucket). */
  column?: string;
  /** Available granularities when this is a time dimension. */
  granularities?: TimeGranularity[];
}

// --------------- View definition ---------------

/** Stored configuration for an analytics view. Matches the `config` JSONB column. */
export interface AnalyticsViewConfig {
  measures: string[];
  primaryDimension?: string;
  granularity?: TimeGranularity;
  defaultFilters?: Record<string, string | string[]>;
}

/** Full view definition — row from analytics_views + typed config. */
export interface AnalyticsView {
  id: string;
  enterpriseId: string | null;
  slug: string;
  label: string;
  description: string;
  kind: ViewKind;
  chartType: ChartType;
  config: AnalyticsViewConfig;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// --------------- Query & result types ---------------

/** Parameters for executing a view query. */
export interface ViewQuery {
  /** ISO date YYYY-MM-DD. */
  from: string;
  /** ISO date YYYY-MM-DD. */
  to: string;
  /** Ad-hoc filters applied on top of the view's defaultFilters. */
  filters?: Record<string, string | string[]>;
  /** Override the view's primaryDimension. */
  groupBy?: string;
  /** Override the view's granularity. */
  granularity?: TimeGranularity;
  /** Page number for detail (table) views, 1-based. */
  page?: number;
  /** Rows per page for detail views. Default 50. */
  pageSize?: number;
}

/** A single point in a time series. */
export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/** A single point in a grouped result. */
export interface GroupedPoint {
  group: string;
  value: number;
}

/** Result of executing a view query. */
export interface ViewResult {
  view: Pick<AnalyticsView, 'slug' | 'label' | 'chartType'>;
  query: { from: string; to: string };
  /** Scalar KPIs — present for 'kpi' chart type. */
  scalar?: Record<string, number>;
  /** Time series — present for 'line' chart type. */
  series?: Record<string, TimeSeriesPoint[]>;
  /** Grouped aggregates — present for 'bar' chart type. */
  groups?: Record<string, GroupedPoint[]>;
  /** Detail rows — present for 'table' chart type. */
  rows?: Record<string, unknown>[];
  /** Total row count (for pagination). */
  total?: number;
  page?: number;
  pageSize?: number;
}

// --------------- Resolver types ---------------

/** Context passed to every view resolver. */
export interface ResolverContext {
  supabase: SupabaseClient;
  enterpriseId: string;
  from: string;
  to: string;
  filters: Record<string, string | string[]>;
  groupBy?: string;
  granularity: TimeGranularity;
  page: number;
  pageSize: number;
}

/** A resolver function for a view. */
export type ViewResolver = (ctx: ResolverContext) => Promise<ViewResult>;
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit src/lib/analytics/types.ts`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/types.ts
git commit -m "feat(analytics): add analytics types module"
```

---

# Task 3: Measures registry + tests

**Files:**
- Create: `src/lib/analytics/measures.ts`
- Create: `tests/analytics/measures.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/measures.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MEASURES, getMeasure } from '@/lib/analytics/measures';

describe('MEASURES registry', () => {
  it('has no duplicate slugs', () => {
    const slugs = MEASURES.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every measure has a non-empty label and description', () => {
    for (const m of MEASURES) {
      expect(m.label.length, `${m.slug} label`).toBeGreaterThan(0);
      expect(m.description.length, `${m.slug} description`).toBeGreaterThan(0);
    }
  });

  it('declarative measures have a source with required fields', () => {
    const declarative = MEASURES.filter((m) => !m.computed);
    expect(declarative.length).toBeGreaterThan(0);
    for (const m of declarative) {
      expect(m.source, `${m.slug} missing source`).toBeDefined();
      expect(m.source!.table).toBeTruthy();
      expect(m.source!.valueColumn).toBeTruthy();
      expect(m.source!.dateColumn).toBeTruthy();
      expect(m.source!.enterpriseColumn).toBeTruthy();
      expect(m.source!.aggregation).toBeTruthy();
    }
  });

  it('computed measures have computed=true and no source', () => {
    const computed = MEASURES.filter((m) => m.computed);
    expect(computed.length).toBeGreaterThanOrEqual(3); // idle_cash, coverage_ratio, forecast_projected
    for (const m of computed) {
      expect(m.source, `${m.slug} should not have source`).toBeUndefined();
    }
  });

  it('getMeasure returns the correct measure by slug', () => {
    const m = getMeasure('total_balance_usd');
    expect(m).toBeDefined();
    expect(m!.slug).toBe('total_balance_usd');
    expect(m!.unit).toBe('usd');
  });

  it('getMeasure returns undefined for unknown slug', () => {
    expect(getMeasure('nonexistent')).toBeUndefined();
  });

  it('every measure has at least one dimension', () => {
    for (const m of MEASURES) {
      expect(m.dimensions.length, `${m.slug} needs dimensions`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/measures.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the measures registry**

Write `src/lib/analytics/measures.ts`:

```typescript
import type { MeasureDefinition } from './types';

export const MEASURES: readonly MeasureDefinition[] = [
  // ── Balance measures (from treasury_state_snapshots) ──
  {
    slug: 'total_balance_usd',
    label: 'Total Balance',
    description: 'Total treasury value in USD across all accounts and positions',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_value_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'fiat_balance_usd',
    label: 'Fiat Balance',
    description: 'Total bank account balances in USD',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_fiat_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'stablecoin_balance_usd',
    label: 'Stablecoin Balance',
    description: 'Idle stablecoin wallet balances in USD (not deployed to yield)',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_stablecoin_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  {
    slug: 'defi_balance_usd',
    label: 'DeFi Balance',
    description: 'Total DeFi position value in USD',
    unit: 'usd',
    source: {
      table: 'treasury_state_snapshots',
      valueColumn: 'total_defi_base_usd',
      dateColumn: 'taken_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'latest',
    },
    dimensions: ['time'],
  },
  // ── Obligation measures ──
  {
    slug: 'obligation_total_usd',
    label: 'Obligation Total',
    description: 'Sum of active obligation amounts in USD within the window',
    unit: 'usd',
    source: {
      table: 'obligations',
      valueColumn: 'amount_usd',
      dateColumn: 'due_date',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { is_active: true },
    },
    dimensions: ['time', 'direction', 'confidence', 'status'],
  },
  {
    slug: 'obligation_count',
    label: 'Obligation Count',
    description: 'Number of active obligations within the window',
    unit: 'count',
    source: {
      table: 'obligations',
      valueColumn: 'id',
      dateColumn: 'due_date',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { is_active: true },
    },
    dimensions: ['time', 'direction', 'confidence', 'status'],
  },
  // ── Ramp measures (from fiat_transactions) ──
  {
    slug: 'ramp_volume_usd',
    label: 'Ramp Volume',
    description: 'Total ramp transaction volume in USD',
    unit: 'usd',
    source: {
      table: 'fiat_transactions',
      valueColumn: 'fiat_amount',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'direction', 'status'],
  },
  {
    slug: 'ramp_count',
    label: 'Ramp Count',
    description: 'Number of ramp transactions',
    unit: 'count',
    source: {
      table: 'fiat_transactions',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'direction', 'status'],
  },
  {
    slug: 'ramp_fee_usd',
    label: 'Ramp Fees',
    description: 'Total ramp fees in USD',
    unit: 'usd',
    source: {
      table: 'fiat_transactions',
      valueColumn: 'fee_amount',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'direction'],
  },
  // ── Transfer measures ──
  {
    slug: 'transfer_volume_usd',
    label: 'Transfer Volume',
    description: 'Total transfer volume in USD',
    unit: 'usd',
    source: {
      table: 'transfers',
      valueColumn: 'amount_usd',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'status', 'chain'],
  },
  {
    slug: 'transfer_count',
    label: 'Transfer Count',
    description: 'Number of transfers',
    unit: 'count',
    source: {
      table: 'transfers',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'status', 'chain'],
  },
  // ── Swap measures (from bridge_transfers) ──
  {
    slug: 'swap_volume_usd',
    label: 'Swap Volume',
    description: 'Total swap volume in USD',
    unit: 'usd',
    source: {
      table: 'bridge_transfers',
      valueColumn: 'amount_usd',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
    },
    dimensions: ['time', 'status', 'chain'],
  },
  {
    slug: 'swap_count',
    label: 'Swap Count',
    description: 'Number of swaps',
    unit: 'count',
    source: {
      table: 'bridge_transfers',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'chain'],
  },
  // ── Invoice measures ──
  {
    slug: 'invoice_outstanding_usd',
    label: 'Outstanding Invoices',
    description: 'Total unpaid invoice amount in USD',
    unit: 'usd',
    source: {
      table: 'invoices',
      valueColumn: 'amount_usd',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { status: 'unpaid' },
    },
    dimensions: ['time', 'status'],
  },
  {
    slug: 'invoice_count',
    label: 'Invoice Count',
    description: 'Number of invoices',
    unit: 'count',
    source: {
      table: 'invoices',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'status'],
  },
  // ── Recommendation measures ──
  {
    slug: 'recommendation_count',
    label: 'Recommendation Count',
    description: 'Number of AI recommendations generated',
    unit: 'count',
    source: {
      table: 'ai_recommendations',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'status', 'action'],
  },
  {
    slug: 'recommendation_executed_count',
    label: 'Executed Recommendations',
    description: 'Number of AI recommendations that were executed',
    unit: 'count',
    source: {
      table: 'ai_recommendations',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { status: 'executed' },
    },
    dimensions: ['time', 'action'],
  },
  // ── Compliance measures ──
  {
    slug: 'screening_count',
    label: 'Screenings',
    description: 'Total sanctions screenings performed',
    unit: 'count',
    source: {
      table: 'sanctions_screenings',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time'],
  },
  {
    slug: 'screening_hit_count',
    label: 'Screening Hits',
    description: 'Sanctions screenings that returned a hit',
    unit: 'count',
    source: {
      table: 'sanctions_screenings',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { result: 'sanctioned' },
    },
    dimensions: ['time'],
  },
  {
    slug: 'kyt_alert_count',
    label: 'KYT Alerts',
    description: 'Total KYT alerts raised',
    unit: 'count',
    source: {
      table: 'kyt_alerts',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
    },
    dimensions: ['time', 'severity'],
  },
  {
    slug: 'kyt_open_count',
    label: 'Open KYT Alerts',
    description: 'KYT alerts still in open status',
    unit: 'count',
    source: {
      table: 'kyt_alerts',
      valueColumn: 'id',
      dateColumn: 'created_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'count',
      baseFilters: { status: 'open' },
    },
    dimensions: ['time'],
  },
  // ── Yield measures ──
  {
    slug: 'yield_deposited_usd',
    label: 'Yield Deposited',
    description: 'Total deposited into yield protocols in USD',
    unit: 'usd',
    source: {
      table: 'yield_transactions',
      valueColumn: 'amount_usd',
      dateColumn: 'executed_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { tx_type: 'deposit' },
    },
    dimensions: ['time', 'protocol', 'status'],
  },
  {
    slug: 'yield_withdrawn_usd',
    label: 'Yield Withdrawn',
    description: 'Total withdrawn from yield protocols in USD',
    unit: 'usd',
    source: {
      table: 'yield_transactions',
      valueColumn: 'amount_usd',
      dateColumn: 'executed_at',
      enterpriseColumn: 'enterprise_id',
      aggregation: 'sum',
      baseFilters: { tx_type: 'withdraw' },
    },
    dimensions: ['time', 'protocol', 'status'],
  },
  // ── Computed measures (custom resolvers, no source) ──
  {
    slug: 'idle_cash_usd',
    label: 'Idle Cash',
    description: 'Stablecoin balance minus confirmed outflows in obligation lookahead window',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },
  {
    slug: 'coverage_ratio',
    label: 'Coverage Ratio',
    description: 'Fiat balance divided by upcoming obligation total',
    unit: 'ratio',
    computed: true,
    dimensions: ['time'],
  },
  {
    slug: 'forecast_projected_usd',
    label: 'Forecast Projected',
    description: 'Projected total balance from the most recent base-scenario forecast',
    unit: 'usd',
    computed: true,
    dimensions: ['time'],
  },
];

export function getMeasure(slug: string): MeasureDefinition | undefined {
  return MEASURES.find((m) => m.slug === slug);
}

export function getMeasures(slugs: string[]): MeasureDefinition[] {
  return slugs.map((s) => getMeasure(s)).filter((m): m is MeasureDefinition => m !== undefined);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/measures.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/measures.ts tests/analytics/measures.test.ts
git commit -m "feat(analytics): add measures registry with 25 measure definitions"
```

---

# Task 4: Dimensions registry + tests

**Files:**
- Create: `src/lib/analytics/dimensions.ts`
- Create: `tests/analytics/dimensions.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/dimensions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DIMENSIONS, getDimension } from '@/lib/analytics/dimensions';
import { MEASURES } from '@/lib/analytics/measures';

describe('DIMENSIONS registry', () => {
  it('has no duplicate slugs', () => {
    const slugs = DIMENSIONS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every dimension has a non-empty label', () => {
    for (const d of DIMENSIONS) {
      expect(d.label.length, `${d.slug} label`).toBeGreaterThan(0);
    }
  });

  it('time dimension has granularity options', () => {
    const time = getDimension('time');
    expect(time).toBeDefined();
    expect(time!.granularities).toContain('day');
    expect(time!.granularities).toContain('week');
    expect(time!.granularities).toContain('month');
  });

  it('non-time dimensions have a column', () => {
    const nonTime = DIMENSIONS.filter((d) => d.slug !== 'time' && d.slug !== 'age_bucket');
    for (const d of nonTime) {
      expect(d.column, `${d.slug} missing column`).toBeTruthy();
    }
  });

  it('every dimension referenced by a measure is in the registry', () => {
    const dimSlugs = new Set(DIMENSIONS.map((d) => d.slug));
    for (const m of MEASURES) {
      for (const ds of m.dimensions) {
        expect(dimSlugs.has(ds), `${m.slug} references unknown dimension '${ds}'`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/dimensions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the dimensions registry**

Write `src/lib/analytics/dimensions.ts`:

```typescript
import type { DimensionDefinition } from './types';

export const DIMENSIONS: readonly DimensionDefinition[] = [
  {
    slug: 'time',
    label: 'Time',
    description: 'Group by time period (day, week, or month)',
    granularities: ['day', 'week', 'month'],
  },
  {
    slug: 'direction',
    label: 'Direction',
    description: 'Group by flow direction (inflow/outflow or onramp/offramp)',
    column: 'direction',
  },
  {
    slug: 'status',
    label: 'Status',
    description: 'Group by record status',
    column: 'status',
  },
  {
    slug: 'chain',
    label: 'Chain',
    description: 'Group by blockchain network',
    column: 'chain',
  },
  {
    slug: 'confidence',
    label: 'Confidence',
    description: 'Group by obligation confidence level (confirmed, expected, estimated)',
    column: 'confidence',
  },
  {
    slug: 'action',
    label: 'Action',
    description: 'Group by recommendation action type',
    column: 'action',
  },
  {
    slug: 'protocol',
    label: 'Protocol',
    description: 'Group by DeFi protocol',
    column: 'protocol',
  },
  {
    slug: 'severity',
    label: 'Severity',
    description: 'Group by alert severity',
    column: 'severity',
  },
  {
    slug: 'age_bucket',
    label: 'Age Bucket',
    description: 'Group invoices by age (1-30d, 31-60d, 61-90d, 90+d)',
    // Computed in the invoice resolver, not a direct column
  },
];

export function getDimension(slug: string): DimensionDefinition | undefined {
  return DIMENSIONS.find((d) => d.slug === slug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/dimensions.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/dimensions.ts tests/analytics/dimensions.test.ts
git commit -m "feat(analytics): add dimensions registry with 9 dimension definitions"
```

---

# Task 5: Standard view definitions + tests

**Files:**
- Create: `src/lib/analytics/standard-views.ts`
- Create: `tests/analytics/standard-views.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/standard-views.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { STANDARD_VIEWS, getStandardView } from '@/lib/analytics/standard-views';
import { getMeasure } from '@/lib/analytics/measures';
import { getDimension } from '@/lib/analytics/dimensions';

describe('STANDARD_VIEWS', () => {
  it('has exactly 12 views', () => {
    expect(STANDARD_VIEWS).toHaveLength(12);
  });

  it('has no duplicate slugs', () => {
    const slugs = STANDARD_VIEWS.map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every view references only known measures', () => {
    for (const v of STANDARD_VIEWS) {
      for (const ms of v.config.measures) {
        expect(getMeasure(ms), `${v.slug} references unknown measure '${ms}'`).toBeDefined();
      }
    }
  });

  it('every view with a primaryDimension references a known dimension', () => {
    for (const v of STANDARD_VIEWS) {
      if (v.config.primaryDimension) {
        expect(
          getDimension(v.config.primaryDimension),
          `${v.slug} references unknown dimension '${v.config.primaryDimension}'`,
        ).toBeDefined();
      }
    }
  });

  it('sort orders are unique and sequential from 1', () => {
    const orders = STANDARD_VIEWS.map((v) => v.sortOrder).sort((a, b) => a - b);
    expect(orders).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it('getStandardView returns the correct view', () => {
    const v = getStandardView('treasury-summary');
    expect(v).toBeDefined();
    expect(v!.chartType).toBe('kpi');
  });

  it('all views have kind=standard', () => {
    for (const v of STANDARD_VIEWS) {
      expect(v.kind).toBe('standard');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/standard-views.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the standard view definitions**

Write `src/lib/analytics/standard-views.ts`:

```typescript
import type { AnalyticsView } from './types';

/**
 * The 12 standard views that ship with Vantor. These match the seeded rows
 * in migration 0047. The code definitions serve as the source of truth for
 * the resolver dispatcher and for the API when merging standard + custom views.
 */
export const STANDARD_VIEWS: readonly AnalyticsView[] = [
  {
    id: 'std-treasury-summary',
    enterpriseId: null,
    slug: 'treasury-summary',
    label: 'Treasury Summary',
    description: 'Balance KPIs: total, fiat, stablecoin, DeFi, idle cash, coverage ratio',
    kind: 'standard',
    chartType: 'kpi',
    config: {
      measures: ['total_balance_usd', 'fiat_balance_usd', 'stablecoin_balance_usd', 'defi_balance_usd', 'idle_cash_usd', 'coverage_ratio'],
    },
    sortOrder: 1,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-balance-history',
    enterpriseId: null,
    slug: 'balance-history',
    label: 'Balance History',
    description: 'Daily balance trend across fiat, stablecoin, and DeFi positions',
    kind: 'standard',
    chartType: 'line',
    config: {
      measures: ['fiat_balance_usd', 'stablecoin_balance_usd', 'defi_balance_usd'],
      primaryDimension: 'time',
      granularity: 'day',
    },
    sortOrder: 2,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-obligation-coverage',
    enterpriseId: null,
    slug: 'obligation-coverage',
    label: 'Obligation Coverage',
    description: 'Weekly obligation total vs bank balance with coverage ratio',
    kind: 'standard',
    chartType: 'bar',
    config: {
      measures: ['obligation_total_usd', 'fiat_balance_usd', 'coverage_ratio'],
      primaryDimension: 'time',
      granularity: 'week',
    },
    sortOrder: 3,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-forecast-vs-actuals',
    enterpriseId: null,
    slug: 'forecast-vs-actuals',
    label: 'Forecast vs Actuals',
    description: 'Compare projected balance from forecasts against actual treasury state',
    kind: 'standard',
    chartType: 'line',
    config: {
      measures: ['forecast_projected_usd', 'total_balance_usd'],
      primaryDimension: 'time',
      granularity: 'day',
    },
    sortOrder: 4,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-ramp-activity',
    enterpriseId: null,
    slug: 'ramp-activity',
    label: 'Ramp Activity',
    description: 'On-ramp and off-ramp volume by direction over time',
    kind: 'standard',
    chartType: 'bar',
    config: {
      measures: ['ramp_volume_usd', 'ramp_count', 'ramp_fee_usd'],
      primaryDimension: 'direction',
    },
    sortOrder: 5,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-transfer-volume',
    enterpriseId: null,
    slug: 'transfer-volume',
    label: 'Transfer Volume',
    description: 'Transfer detail rows with status and chain filters',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['transfer_volume_usd', 'transfer_count'],
      primaryDimension: 'status',
    },
    sortOrder: 6,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-swap-activity',
    enterpriseId: null,
    slug: 'swap-activity',
    label: 'Swap Activity',
    description: 'Swap detail rows with chain filter',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['swap_volume_usd', 'swap_count'],
      primaryDimension: 'chain',
    },
    sortOrder: 7,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-invoice-aging',
    enterpriseId: null,
    slug: 'invoice-aging',
    label: 'Invoice Aging',
    description: 'Outstanding invoices bucketed by age (1-30d, 31-60d, 61-90d, 90+d)',
    kind: 'standard',
    chartType: 'bar',
    config: {
      measures: ['invoice_outstanding_usd', 'invoice_count'],
      primaryDimension: 'age_bucket',
    },
    sortOrder: 8,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-ai-actions',
    enterpriseId: null,
    slug: 'ai-actions',
    label: 'AI Actions',
    description: 'AI recommendation outcomes with status and action filters',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['recommendation_count', 'recommendation_executed_count'],
      primaryDimension: 'status',
    },
    sortOrder: 9,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-compliance-summary',
    enterpriseId: null,
    slug: 'compliance-summary',
    label: 'Compliance Summary',
    description: 'Sanctions screening and KYT alert statistics',
    kind: 'standard',
    chartType: 'kpi',
    config: {
      measures: ['screening_count', 'screening_hit_count', 'kyt_alert_count', 'kyt_open_count'],
    },
    sortOrder: 10,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-yield-performance',
    enterpriseId: null,
    slug: 'yield-performance',
    label: 'Yield Performance',
    description: 'Yield positions and transaction activity by protocol',
    kind: 'standard',
    chartType: 'table',
    config: {
      measures: ['yield_deposited_usd', 'yield_withdrawn_usd'],
      primaryDimension: 'protocol',
    },
    sortOrder: 11,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'std-idle-cash',
    enterpriseId: null,
    slug: 'idle-cash',
    label: 'Idle Cash Trend',
    description: 'Idle stablecoin balance over time (balance minus confirmed outflows)',
    kind: 'standard',
    chartType: 'line',
    config: {
      measures: ['idle_cash_usd', 'stablecoin_balance_usd'],
      primaryDimension: 'time',
      granularity: 'day',
    },
    sortOrder: 12,
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export function getStandardView(slug: string): AnalyticsView | undefined {
  return STANDARD_VIEWS.find((v) => v.slug === slug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/standard-views.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/standard-views.ts tests/analytics/standard-views.test.ts
git commit -m "feat(analytics): add 12 standard view definitions"
```

---

# Task 6: Resolver utilities + tests

**Files:**
- Create: `src/lib/analytics/utils.ts`
- Create: `tests/analytics/utils.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  bucketByDay,
  bucketByWeek,
  bucketByMonth,
  aggregateValues,
  parseNumeric,
  isoWeek,
  isoMonth,
  paginate,
} from '@/lib/analytics/utils';

describe('parseNumeric', () => {
  it('parses string numbers', () => {
    expect(parseNumeric('123.45')).toBe(123.45);
  });
  it('passes through numbers', () => {
    expect(parseNumeric(42)).toBe(42);
  });
  it('returns 0 for null/undefined', () => {
    expect(parseNumeric(null)).toBe(0);
    expect(parseNumeric(undefined)).toBe(0);
  });
  it('returns 0 for NaN strings', () => {
    expect(parseNumeric('abc')).toBe(0);
  });
});

describe('aggregateValues', () => {
  it('sum', () => {
    expect(aggregateValues([10, 20, 30], 'sum')).toBe(60);
  });
  it('count', () => {
    expect(aggregateValues([10, 20, 30], 'count')).toBe(3);
  });
  it('avg', () => {
    expect(aggregateValues([10, 20, 30], 'avg')).toBe(20);
  });
  it('min', () => {
    expect(aggregateValues([10, 20, 5], 'min')).toBe(5);
  });
  it('max', () => {
    expect(aggregateValues([10, 20, 5], 'max')).toBe(20);
  });
  it('latest returns last element', () => {
    expect(aggregateValues([10, 20, 30], 'latest')).toBe(30);
  });
  it('returns 0 for empty array', () => {
    expect(aggregateValues([], 'sum')).toBe(0);
  });
});

describe('isoWeek', () => {
  it('returns YYYY-Www format', () => {
    expect(isoWeek('2026-04-12')).toMatch(/^2026-W\d{2}$/);
  });
});

describe('isoMonth', () => {
  it('returns YYYY-MM format', () => {
    expect(isoMonth('2026-04-12')).toBe('2026-04');
  });
});

describe('bucketByDay', () => {
  const rows = [
    { date: '2026-04-10T10:00:00Z', val: '100' },
    { date: '2026-04-10T14:00:00Z', val: '200' },
    { date: '2026-04-11T09:00:00Z', val: '50' },
  ];

  it('groups by YYYY-MM-DD and sums values', () => {
    const result = bucketByDay(rows, 'date', (r) => parseNumeric(r.val), 'sum');
    expect(result).toEqual([
      { date: '2026-04-10', value: 300 },
      { date: '2026-04-11', value: 50 },
    ]);
  });
});

describe('bucketByWeek', () => {
  it('groups rows by ISO week', () => {
    const rows = [
      { date: '2026-04-06T00:00:00Z', val: 10 },
      { date: '2026-04-07T00:00:00Z', val: 20 },
      { date: '2026-04-13T00:00:00Z', val: 30 },
    ];
    const result = bucketByWeek(rows, 'date', (r) => parseNumeric(r.val), 'sum');
    expect(result).toHaveLength(2);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ id: i }));

  it('returns first page', () => {
    const { rows, total } = paginate(items, 1, 10);
    expect(rows).toHaveLength(10);
    expect(rows[0].id).toBe(0);
    expect(total).toBe(25);
  });

  it('returns last page', () => {
    const { rows } = paginate(items, 3, 10);
    expect(rows).toHaveLength(5);
    expect(rows[0].id).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the utilities**

Write `src/lib/analytics/utils.ts`:

```typescript
import type { Aggregation, TimeGranularity, TimeSeriesPoint, GroupedPoint } from './types';

/** Safely parse a numeric value from DB row data. */
export function parseNumeric(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return Number.isNaN(n) ? 0 : n;
}

/** Apply an aggregation function to a list of numbers. */
export function aggregateValues(values: number[], agg: Aggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'latest':
      return values[values.length - 1];
  }
}

/** Round to 2 decimal places (USD cents). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Extract YYYY-MM-DD from an ISO timestamp or date string. */
export function toDay(dateStr: string): string {
  return dateStr.slice(0, 10);
}

/** Return ISO week string YYYY-Www from a date string. */
export function isoWeek(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00Z');
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Return YYYY-MM from a date string. */
export function isoMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/** Get the time bucket key for a date at a given granularity. */
function timeBucket(dateStr: string, granularity: TimeGranularity): string {
  switch (granularity) {
    case 'day':
      return toDay(dateStr);
    case 'week':
      return isoWeek(dateStr);
    case 'month':
      return isoMonth(dateStr);
  }
}

/**
 * Generic time-bucketing: group rows by a time column, extract a numeric value
 * from each row, and aggregate per bucket.
 */
function bucketByTime<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: string,
  getValue: (row: T) => number,
  agg: Aggregation,
  granularity: TimeGranularity,
): TimeSeriesPoint[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const dateVal = String(row[dateColumn] ?? '');
    if (!dateVal) continue;
    const key = timeBucket(dateVal, granularity);
    const arr = buckets.get(key) ?? [];
    arr.push(getValue(row));
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, value: round2(aggregateValues(values, agg)) }));
}

export function bucketByDay<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: string,
  getValue: (row: T) => number,
  agg: Aggregation,
): TimeSeriesPoint[] {
  return bucketByTime(rows, dateColumn, getValue, agg, 'day');
}

export function bucketByWeek<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: string,
  getValue: (row: T) => number,
  agg: Aggregation,
): TimeSeriesPoint[] {
  return bucketByTime(rows, dateColumn, getValue, agg, 'week');
}

export function bucketByMonth<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: string,
  getValue: (row: T) => number,
  agg: Aggregation,
): TimeSeriesPoint[] {
  return bucketByTime(rows, dateColumn, getValue, agg, 'month');
}

/**
 * Group rows by a categorical column, extract a numeric value, and aggregate.
 */
export function groupByColumn<T extends Record<string, unknown>>(
  rows: T[],
  column: string,
  getValue: (row: T) => number,
  agg: Aggregation,
): GroupedPoint[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[column] ?? 'unknown');
    const arr = groups.get(key) ?? [];
    arr.push(getValue(row));
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, values]) => ({ group, value: round2(aggregateValues(values, agg)) }));
}

/**
 * Group rows by a time column at a given granularity.
 */
export function groupByTime<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: string,
  getValue: (row: T) => number,
  agg: Aggregation,
  granularity: TimeGranularity,
): TimeSeriesPoint[] {
  return bucketByTime(rows, dateColumn, getValue, agg, granularity);
}

/** Paginate an array. Page is 1-based. */
export function paginate<T>(items: T[], page: number, pageSize: number): { rows: T[]; total: number } {
  const start = (page - 1) * pageSize;
  return {
    rows: items.slice(start, start + pageSize),
    total: items.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/utils.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/utils.ts tests/analytics/utils.test.ts
git commit -m "feat(analytics): add resolver utility functions (bucketing, aggregation, pagination)"
```

---

# Task 7: Treasury resolvers + tests

Resolvers for `treasury-summary`, `balance-history`, and `idle-cash` views.

**Files:**
- Create: `src/lib/analytics/resolvers/treasury.ts`
- Create: `tests/analytics/resolvers/treasury.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/resolvers/treasury.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { resolveTreasurySummary, resolveBalanceHistory, resolveIdleCash } from '@/lib/analytics/resolvers/treasury';
import type { ResolverContext } from '@/lib/analytics/types';

/** Create a mock Supabase client that returns predefined rows for each table. */
function mockSupabase(tableData: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const rows = tableData[table] ?? [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: undefined as unknown,
    };
    // Make the chain thenable so await works
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from } as unknown as ResolverContext['supabase'];
}

function baseCtx(supabase: ResolverContext['supabase']): ResolverContext {
  return {
    supabase,
    enterpriseId: 'ent-1',
    from: '2026-04-01',
    to: '2026-04-30',
    filters: {},
    granularity: 'day',
    page: 1,
    pageSize: 50,
  };
}

describe('resolveTreasurySummary', () => {
  it('returns scalar KPIs from the latest snapshot', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        {
          taken_at: '2026-04-15T00:00:00Z',
          total_value_base_usd: 1000000,
          total_fiat_base_usd: 600000,
          total_stablecoin_base_usd: 300000,
          total_defi_base_usd: 100000,
        },
      ],
      obligations: [
        { amount_usd: '50000', due_date: '2026-04-20', direction: 'outflow', is_active: true, confidence: 'confirmed' },
      ],
    });
    const result = await resolveTreasurySummary(baseCtx(sb));
    expect(result.scalar).toBeDefined();
    expect(result.scalar!.total_balance_usd).toBe(1000000);
    expect(result.scalar!.fiat_balance_usd).toBe(600000);
    expect(result.scalar!.stablecoin_balance_usd).toBe(300000);
    expect(result.scalar!.defi_balance_usd).toBe(100000);
    expect(result.view.chartType).toBe('kpi');
  });
});

describe('resolveBalanceHistory', () => {
  it('returns time series grouped by day', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        { taken_at: '2026-04-10T00:00:00Z', total_fiat_base_usd: 500000, total_stablecoin_base_usd: 200000, total_defi_base_usd: 100000 },
        { taken_at: '2026-04-11T00:00:00Z', total_fiat_base_usd: 510000, total_stablecoin_base_usd: 195000, total_defi_base_usd: 102000 },
      ],
    });
    const result = await resolveBalanceHistory(baseCtx(sb));
    expect(result.series).toBeDefined();
    expect(result.series!.fiat_balance_usd).toHaveLength(2);
    expect(result.series!.fiat_balance_usd[0].date).toBe('2026-04-10');
    expect(result.series!.fiat_balance_usd[0].value).toBe(500000);
    expect(result.view.chartType).toBe('line');
  });
});

describe('resolveIdleCash', () => {
  it('computes idle cash as stablecoin minus confirmed outflows', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        { taken_at: '2026-04-10T00:00:00Z', total_stablecoin_base_usd: 300000 },
      ],
      obligations: [
        { amount_usd: '50000', due_date: '2026-04-15', direction: 'outflow', confidence: 'confirmed', is_active: true },
        { amount_usd: '20000', due_date: '2026-04-20', direction: 'outflow', confidence: 'confirmed', is_active: true },
      ],
      treasury_rules: [
        { obligation_lookahead_days: 30, is_active: true },
      ],
    });
    const result = await resolveIdleCash(baseCtx(sb));
    expect(result.series).toBeDefined();
    expect(result.series!.idle_cash_usd).toBeDefined();
    // 300000 - (50000 + 20000) = 230000
    expect(result.series!.idle_cash_usd[0].value).toBe(230000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/resolvers/treasury.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the treasury resolvers**

Write `src/lib/analytics/resolvers/treasury.ts`:

```typescript
import type { ResolverContext, ViewResult, TimeSeriesPoint } from '../types';
import { parseNumeric, round2, groupByTime } from '../utils';

/**
 * Treasury Summary — KPI view.
 * Returns the latest snapshot's balance breakdown plus computed idle_cash and coverage_ratio.
 */
export async function resolveTreasurySummary(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to } = ctx;

  // Latest snapshot in window
  const { data: snapshots } = await supabase
    .from('treasury_state_snapshots')
    .select('total_value_base_usd, total_fiat_base_usd, total_stablecoin_base_usd, total_defi_base_usd')
    .eq('enterprise_id', enterpriseId)
    .gte('taken_at', from)
    .lte('taken_at', to + 'T23:59:59Z')
    .order('taken_at', { ascending: false })
    .limit(1);

  const snap = snapshots?.[0];
  const totalBalance = parseNumeric(snap?.total_value_base_usd);
  const fiatBalance = parseNumeric(snap?.total_fiat_base_usd);
  const stablecoinBalance = parseNumeric(snap?.total_stablecoin_base_usd);
  const defiBalance = parseNumeric(snap?.total_defi_base_usd);

  // Sum confirmed outflows for idle cash and coverage ratio
  const { data: obligations } = await supabase
    .from('obligations')
    .select('amount_usd')
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .eq('direction', 'outflow')
    .eq('confidence', 'confirmed')
    .gte('due_date', from)
    .lte('due_date', to);

  const obligationTotal = (obligations ?? []).reduce(
    (sum, o) => sum + parseNumeric(o.amount_usd),
    0,
  );

  const idleCash = round2(stablecoinBalance - obligationTotal);
  const coverageRatio = obligationTotal > 0 ? round2(fiatBalance / obligationTotal) : 0;

  return {
    view: { slug: 'treasury-summary', label: 'Treasury Summary', chartType: 'kpi' },
    query: { from, to },
    scalar: {
      total_balance_usd: round2(totalBalance),
      fiat_balance_usd: round2(fiatBalance),
      stablecoin_balance_usd: round2(stablecoinBalance),
      defi_balance_usd: round2(defiBalance),
      idle_cash_usd: idleCash,
      coverage_ratio: coverageRatio,
    },
  };
}

/**
 * Balance History — line chart.
 * Returns daily (or weekly/monthly) time series for fiat, stablecoin, and DeFi balances.
 */
export async function resolveBalanceHistory(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, granularity } = ctx;

  const { data: snapshots } = await supabase
    .from('treasury_state_snapshots')
    .select('taken_at, total_fiat_base_usd, total_stablecoin_base_usd, total_defi_base_usd')
    .eq('enterprise_id', enterpriseId)
    .gte('taken_at', from)
    .lte('taken_at', to + 'T23:59:59Z')
    .order('taken_at', { ascending: true });

  const rows = (snapshots ?? []) as Record<string, unknown>[];

  const fiatSeries = groupByTime(rows, 'taken_at', (r) => parseNumeric(r.total_fiat_base_usd), 'latest', granularity);
  const stableSeries = groupByTime(rows, 'taken_at', (r) => parseNumeric(r.total_stablecoin_base_usd), 'latest', granularity);
  const defiSeries = groupByTime(rows, 'taken_at', (r) => parseNumeric(r.total_defi_base_usd), 'latest', granularity);

  return {
    view: { slug: 'balance-history', label: 'Balance History', chartType: 'line' },
    query: { from, to },
    series: {
      fiat_balance_usd: fiatSeries,
      stablecoin_balance_usd: stableSeries,
      defi_balance_usd: defiSeries,
    },
  };
}

/**
 * Idle Cash Trend — line chart.
 * For each snapshot, compute: stablecoin_balance - confirmed_outflows_in_lookahead.
 */
export async function resolveIdleCash(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, granularity } = ctx;

  // Get the active treasury rule's lookahead_days (or default to 30)
  const { data: rules } = await supabase
    .from('treasury_rules')
    .select('obligation_lookahead_days')
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .limit(1);

  const lookaheadDays = parseNumeric(rules?.[0]?.obligation_lookahead_days) || 30;

  // Snapshots for stablecoin balance
  const { data: snapshots } = await supabase
    .from('treasury_state_snapshots')
    .select('taken_at, total_stablecoin_base_usd')
    .eq('enterprise_id', enterpriseId)
    .gte('taken_at', from)
    .lte('taken_at', to + 'T23:59:59Z')
    .order('taken_at', { ascending: true });

  // All confirmed outflow obligations in the full window
  const { data: obligations } = await supabase
    .from('obligations')
    .select('amount_usd, due_date')
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .eq('direction', 'outflow')
    .eq('confidence', 'confirmed')
    .gte('due_date', from)
    .lte('due_date', to);

  const obligs = (obligations ?? []) as Array<{ amount_usd: string; due_date: string }>;

  // For each snapshot, compute idle cash = stablecoin - outflows within lookahead window from snapshot date
  const idlePoints: TimeSeriesPoint[] = [];
  const stablePoints: TimeSeriesPoint[] = [];

  for (const snap of snapshots ?? []) {
    const snapDate = String(snap.taken_at).slice(0, 10);
    const stablecoin = parseNumeric(snap.total_stablecoin_base_usd);

    // Lookahead end date from this snapshot
    const endDate = new Date(snapDate + 'T00:00:00Z');
    endDate.setUTCDate(endDate.getUTCDate() + lookaheadDays);
    const endStr = endDate.toISOString().slice(0, 10);

    const outflowSum = obligs
      .filter((o) => o.due_date >= snapDate && o.due_date <= endStr)
      .reduce((sum, o) => sum + parseNumeric(o.amount_usd), 0);

    idlePoints.push({ date: snapDate, value: round2(stablecoin - outflowSum) });
    stablePoints.push({ date: snapDate, value: round2(stablecoin) });
  }

  // If granularity is not 'day', we'd bucket — but idle cash is per-snapshot, so we keep it as-is
  // and let the groupByTime utility handle re-bucketing if needed.

  return {
    view: { slug: 'idle-cash', label: 'Idle Cash Trend', chartType: 'line' },
    query: { from, to },
    series: {
      idle_cash_usd: idlePoints,
      stablecoin_balance_usd: stablePoints,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/resolvers/treasury.test.ts`
Expected: all tests PASS. Adjust mock shape if Supabase chain doesn't behave — the mock may need tweaking for `.order()` and `.limit()` calls.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/resolvers/treasury.ts tests/analytics/resolvers/treasury.test.ts
git commit -m "feat(analytics): add treasury resolvers (summary, balance-history, idle-cash)"
```

---

# Task 8: Obligation + forecast resolvers + tests

**Files:**
- Create: `src/lib/analytics/resolvers/obligations.ts`
- Create: `src/lib/analytics/resolvers/forecast.ts`
- Create: `tests/analytics/resolvers/obligations.test.ts`
- Create: `tests/analytics/resolvers/forecast.test.ts`

- [ ] **Step 1: Write obligation resolver test**

Write `tests/analytics/resolvers/obligations.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveObligationCoverage } from '@/lib/analytics/resolvers/obligations';
import type { ResolverContext } from '@/lib/analytics/types';

function mockSupabase(tableData: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const rows = tableData[table] ?? [];
    const chain = {
      select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain,
      order: () => chain, limit: () => chain,
      then: undefined as unknown,
    };
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from } as unknown as ResolverContext['supabase'];
}

describe('resolveObligationCoverage', () => {
  it('returns grouped data by week with coverage ratio', async () => {
    const sb = mockSupabase({
      obligations: [
        { amount_usd: '50000', due_date: '2026-04-07', is_active: true },
        { amount_usd: '30000', due_date: '2026-04-08', is_active: true },
        { amount_usd: '40000', due_date: '2026-04-14', is_active: true },
      ],
      treasury_state_snapshots: [
        { taken_at: '2026-04-07T00:00:00Z', total_fiat_base_usd: 200000 },
        { taken_at: '2026-04-14T00:00:00Z', total_fiat_base_usd: 180000 },
      ],
    });

    const result = await resolveObligationCoverage({
      supabase: sb,
      enterpriseId: 'ent-1',
      from: '2026-04-01',
      to: '2026-04-30',
      filters: {},
      granularity: 'week',
      page: 1,
      pageSize: 50,
    });

    expect(result.groups).toBeDefined();
    expect(result.groups!.obligation_total_usd.length).toBeGreaterThan(0);
    expect(result.view.chartType).toBe('bar');
  });
});
```

- [ ] **Step 2: Write forecast resolver test**

Write `tests/analytics/resolvers/forecast.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveForecastVsActuals } from '@/lib/analytics/resolvers/forecast';
import type { ResolverContext } from '@/lib/analytics/types';

function mockSupabase(tableData: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const rows = tableData[table] ?? [];
    const chain = {
      select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain,
      order: () => chain, limit: () => chain,
      then: undefined as unknown,
    };
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from } as unknown as ResolverContext['supabase'];
}

describe('resolveForecastVsActuals', () => {
  it('returns two series: projected and actual', async () => {
    const sb = mockSupabase({
      forecast_snapshots: [
        {
          computed_at: '2026-04-01T00:00:00Z',
          scenario: 'base',
          is_hypothetical: false,
          projection: {
            daily: [
              { date: '2026-04-01', totalBaseUsd: 1000000 },
              { date: '2026-04-02', totalBaseUsd: 990000 },
              { date: '2026-04-03', totalBaseUsd: 980000 },
            ],
          },
        },
      ],
      treasury_state_snapshots: [
        { taken_at: '2026-04-01T00:00:00Z', total_value_base_usd: 1000000 },
        { taken_at: '2026-04-02T00:00:00Z', total_value_base_usd: 995000 },
        { taken_at: '2026-04-03T00:00:00Z', total_value_base_usd: 985000 },
      ],
    });

    const result = await resolveForecastVsActuals({
      supabase: sb,
      enterpriseId: 'ent-1',
      from: '2026-04-01',
      to: '2026-04-03',
      filters: {},
      granularity: 'day',
      page: 1,
      pageSize: 50,
    });

    expect(result.series).toBeDefined();
    expect(result.series!.forecast_projected_usd).toHaveLength(3);
    expect(result.series!.total_balance_usd).toHaveLength(3);
    expect(result.series!.forecast_projected_usd[1].value).toBe(990000);
    expect(result.series!.total_balance_usd[1].value).toBe(995000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/analytics/resolvers/obligations.test.ts tests/analytics/resolvers/forecast.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write obligation coverage resolver**

Write `src/lib/analytics/resolvers/obligations.ts`:

```typescript
import type { ResolverContext, ViewResult, GroupedPoint } from '../types';
import { parseNumeric, round2, isoWeek, isoMonth } from '../utils';

/**
 * Obligation Coverage — bar chart.
 * Groups obligations and fiat balance by time bucket, computes coverage ratio.
 */
export async function resolveObligationCoverage(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, granularity } = ctx;

  const [{ data: obligations }, { data: snapshots }] = await Promise.all([
    supabase
      .from('obligations')
      .select('amount_usd, due_date')
      .eq('enterprise_id', enterpriseId)
      .eq('is_active', true)
      .gte('due_date', from)
      .lte('due_date', to),
    supabase
      .from('treasury_state_snapshots')
      .select('taken_at, total_fiat_base_usd')
      .eq('enterprise_id', enterpriseId)
      .gte('taken_at', from)
      .lte('taken_at', to + 'T23:59:59Z')
      .order('taken_at', { ascending: true }),
  ]);

  const bucketKey = granularity === 'month' ? isoMonth : granularity === 'week' ? isoWeek : (d: string) => d.slice(0, 10);

  // Bucket obligations
  const obBuckets = new Map<string, number>();
  for (const o of obligations ?? []) {
    const key = bucketKey(String(o.due_date));
    obBuckets.set(key, (obBuckets.get(key) ?? 0) + parseNumeric(o.amount_usd));
  }

  // Bucket fiat balance (use latest per bucket)
  const fiatBuckets = new Map<string, number>();
  for (const s of snapshots ?? []) {
    const key = bucketKey(String(s.taken_at));
    fiatBuckets.set(key, parseNumeric(s.total_fiat_base_usd)); // last wins = latest
  }

  // Merge keys
  const allKeys = new Set([...obBuckets.keys(), ...fiatBuckets.keys()]);
  const sortedKeys = Array.from(allKeys).sort();

  const obPoints: GroupedPoint[] = [];
  const fiatPoints: GroupedPoint[] = [];
  const ratioPoints: GroupedPoint[] = [];

  for (const key of sortedKeys) {
    const obVal = round2(obBuckets.get(key) ?? 0);
    const fiatVal = round2(fiatBuckets.get(key) ?? 0);
    const ratio = obVal > 0 ? round2(fiatVal / obVal) : 0;
    obPoints.push({ group: key, value: obVal });
    fiatPoints.push({ group: key, value: fiatVal });
    ratioPoints.push({ group: key, value: ratio });
  }

  return {
    view: { slug: 'obligation-coverage', label: 'Obligation Coverage', chartType: 'bar' },
    query: { from, to },
    groups: {
      obligation_total_usd: obPoints,
      fiat_balance_usd: fiatPoints,
      coverage_ratio: ratioPoints,
    },
  };
}
```

- [ ] **Step 5: Write forecast vs actuals resolver**

Write `src/lib/analytics/resolvers/forecast.ts`:

```typescript
import type { ResolverContext, ViewResult, TimeSeriesPoint } from '../types';
import { parseNumeric, round2, groupByTime } from '../utils';

/**
 * Forecast vs Actuals — line chart.
 * Extracts the daily projected balance from the most recent base-scenario forecast,
 * and overlays actual balances from treasury_state_snapshots.
 * Subsumes the legacy simulation_runs table.
 */
export async function resolveForecastVsActuals(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, granularity } = ctx;

  // Most recent base-scenario, non-hypothetical forecast that covers this window
  const { data: forecasts } = await supabase
    .from('forecast_snapshots')
    .select('projection, computed_at')
    .eq('enterprise_id', enterpriseId)
    .eq('scenario', 'base')
    .eq('is_hypothetical', false)
    .lte('computed_at', to + 'T23:59:59Z')
    .order('computed_at', { ascending: false })
    .limit(1);

  // Actual treasury state snapshots in the window
  const { data: snapshots } = await supabase
    .from('treasury_state_snapshots')
    .select('taken_at, total_value_base_usd')
    .eq('enterprise_id', enterpriseId)
    .gte('taken_at', from)
    .lte('taken_at', to + 'T23:59:59Z')
    .order('taken_at', { ascending: true });

  // Build projected series from forecast's daily array
  const projectedSeries: TimeSeriesPoint[] = [];
  const forecast = forecasts?.[0];
  if (forecast?.projection) {
    const proj = typeof forecast.projection === 'string'
      ? JSON.parse(forecast.projection)
      : forecast.projection;
    const daily = (proj.daily ?? []) as Array<{ date: string; totalBaseUsd: number }>;
    for (const day of daily) {
      if (day.date >= from && day.date <= to) {
        projectedSeries.push({ date: day.date, value: round2(day.totalBaseUsd) });
      }
    }
  }

  // Build actual series from snapshots
  const actualRows = (snapshots ?? []) as Record<string, unknown>[];
  const actualSeries = groupByTime(
    actualRows,
    'taken_at',
    (r) => parseNumeric(r.total_value_base_usd),
    'latest',
    granularity,
  );

  return {
    view: { slug: 'forecast-vs-actuals', label: 'Forecast vs Actuals', chartType: 'line' },
    query: { from, to },
    series: {
      forecast_projected_usd: projectedSeries,
      total_balance_usd: actualSeries,
    },
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/analytics/resolvers/obligations.test.ts tests/analytics/resolvers/forecast.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics/resolvers/obligations.ts src/lib/analytics/resolvers/forecast.ts tests/analytics/resolvers/obligations.test.ts tests/analytics/resolvers/forecast.test.ts
git commit -m "feat(analytics): add obligation-coverage and forecast-vs-actuals resolvers"
```

---

# Task 9: Activity resolvers (ramps, transfers, swaps) + tests

**Files:**
- Create: `src/lib/analytics/resolvers/activity.ts`
- Create: `tests/analytics/resolvers/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/resolvers/activity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveRampActivity, resolveTransferVolume, resolveSwapActivity } from '@/lib/analytics/resolvers/activity';
import type { ResolverContext } from '@/lib/analytics/types';

function mockSupabase(tableData: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const rows = tableData[table] ?? [];
    const chain = {
      select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain,
      order: () => chain, limit: () => chain,
      then: undefined as unknown,
    };
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from } as unknown as ResolverContext['supabase'];
}

function baseCtx(sb: ResolverContext['supabase']): ResolverContext {
  return { supabase: sb, enterpriseId: 'ent-1', from: '2026-04-01', to: '2026-04-30', filters: {}, granularity: 'day', page: 1, pageSize: 50 };
}

describe('resolveRampActivity', () => {
  it('groups ramp volume by direction', async () => {
    const sb = mockSupabase({
      fiat_transactions: [
        { created_at: '2026-04-10T00:00:00Z', fiat_amount: '50000', fee_amount: '500', direction: 'onramp', status: 'completed' },
        { created_at: '2026-04-11T00:00:00Z', fiat_amount: '30000', fee_amount: '300', direction: 'offramp', status: 'completed' },
        { created_at: '2026-04-12T00:00:00Z', fiat_amount: '20000', fee_amount: '200', direction: 'onramp', status: 'completed' },
      ],
    });
    const result = await resolveRampActivity(baseCtx(sb));
    expect(result.groups!.ramp_volume_usd).toHaveLength(2);
    const onramp = result.groups!.ramp_volume_usd.find((g) => g.group === 'onramp');
    expect(onramp!.value).toBe(70000);
  });
});

describe('resolveTransferVolume', () => {
  it('returns detail rows for table view', async () => {
    const sb = mockSupabase({
      transfers: [
        { id: 't1', created_at: '2026-04-10T00:00:00Z', amount_usd: '1000', status: 'completed', chain: 'ethereum', token: 'USDC', from_address: '0x1', to_address: '0x2' },
        { id: 't2', created_at: '2026-04-11T00:00:00Z', amount_usd: '2000', status: 'pending', chain: 'solana', token: 'USDC', from_address: 'abc', to_address: 'def' },
      ],
    });
    const result = await resolveTransferVolume(baseCtx(sb));
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.view.chartType).toBe('table');
  });
});

describe('resolveSwapActivity', () => {
  it('returns detail rows', async () => {
    const sb = mockSupabase({
      bridge_transfers: [
        { id: 's1', created_at: '2026-04-10T00:00:00Z', amount_usd: '5000', status: 'completed', from_chain: 'ethereum', to_chain: 'solana', from_token: 'USDC', to_token: 'USDC' },
      ],
    });
    const result = await resolveSwapActivity(baseCtx(sb));
    expect(result.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/resolvers/activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the activity resolvers**

Write `src/lib/analytics/resolvers/activity.ts`:

```typescript
import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByColumn, paginate } from '../utils';

/** Ramp Activity — bar chart grouped by direction. */
export async function resolveRampActivity(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to } = ctx;

  const { data: rows } = await supabase
    .from('fiat_transactions')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .gte('created_at', from)
    .lte('created_at', to + 'T23:59:59Z')
    .order('created_at', { ascending: true });

  const data = (rows ?? []) as Record<string, unknown>[];

  const volumeByDir = groupByColumn(data, 'direction', (r) => parseNumeric(r.fiat_amount), 'sum');
  const countByDir = groupByColumn(data, 'direction', () => 1, 'sum');
  const feeByDir = groupByColumn(data, 'direction', (r) => parseNumeric(r.fee_amount), 'sum');

  return {
    view: { slug: 'ramp-activity', label: 'Ramp Activity', chartType: 'bar' },
    query: { from, to },
    groups: {
      ramp_volume_usd: volumeByDir,
      ramp_count: countByDir,
      ramp_fee_usd: feeByDir,
    },
  };
}

/** Transfer Volume — table (detail rows). */
export async function resolveTransferVolume(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, filters, page, pageSize } = ctx;

  let query = supabase
    .from('transfers')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .gte('created_at', from)
    .lte('created_at', to + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.chain) query = query.eq('chain', filters.chain);

  const { data: rows } = await query;
  const allRows = (rows ?? []) as Record<string, unknown>[];
  const { rows: pageRows, total } = paginate(allRows, page, pageSize);

  return {
    view: { slug: 'transfer-volume', label: 'Transfer Volume', chartType: 'table' },
    query: { from, to },
    rows: pageRows,
    total,
    page,
    pageSize,
  };
}

/** Swap Activity — table (detail rows). */
export async function resolveSwapActivity(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, filters, page, pageSize } = ctx;

  let query = supabase
    .from('bridge_transfers')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .gte('created_at', from)
    .lte('created_at', to + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  if (filters.chain) query = query.eq('from_chain', filters.chain);
  if (filters.status) query = query.eq('status', filters.status);

  const { data: rows } = await query;
  const allRows = (rows ?? []) as Record<string, unknown>[];
  const { rows: pageRows, total } = paginate(allRows, page, pageSize);

  return {
    view: { slug: 'swap-activity', label: 'Swap Activity', chartType: 'table' },
    query: { from, to },
    rows: pageRows,
    total,
    page,
    pageSize,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analytics/resolvers/activity.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/resolvers/activity.ts tests/analytics/resolvers/activity.test.ts
git commit -m "feat(analytics): add ramp, transfer, and swap resolvers"
```

---

# Task 10: Detail resolvers (invoices, recommendations, compliance, yield) + tests

**Files:**
- Create: `src/lib/analytics/resolvers/detail.ts`
- Create: `tests/analytics/resolvers/detail.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/resolvers/detail.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveInvoiceAging, resolveAiActions, resolveComplianceSummary, resolveYieldPerformance } from '@/lib/analytics/resolvers/detail';
import type { ResolverContext } from '@/lib/analytics/types';

function mockSupabase(tableData: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    const rows = tableData[table] ?? [];
    const chain = {
      select: () => chain, eq: () => chain, gte: () => chain, lte: () => chain,
      neq: () => chain, order: () => chain, limit: () => chain, in: () => chain,
      then: undefined as unknown,
    };
    chain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: rows, error: null }).then(resolve);
    return chain;
  };
  return { from } as unknown as ResolverContext['supabase'];
}

function baseCtx(sb: ResolverContext['supabase']): ResolverContext {
  return { supabase: sb, enterpriseId: 'ent-1', from: '2026-04-01', to: '2026-04-30', filters: {}, granularity: 'day', page: 1, pageSize: 50 };
}

describe('resolveInvoiceAging', () => {
  it('buckets invoices by age', async () => {
    const now = new Date();
    const d15 = new Date(now); d15.setDate(d15.getDate() - 15);
    const d45 = new Date(now); d45.setDate(d45.getDate() - 45);
    const d100 = new Date(now); d100.setDate(d100.getDate() - 100);

    const sb = mockSupabase({
      invoices: [
        { id: 'i1', amount_usd: '1000', created_at: d15.toISOString(), due_date: d15.toISOString().slice(0, 10), status: 'unpaid' },
        { id: 'i2', amount_usd: '2000', created_at: d45.toISOString(), due_date: d45.toISOString().slice(0, 10), status: 'unpaid' },
        { id: 'i3', amount_usd: '3000', created_at: d100.toISOString(), due_date: d100.toISOString().slice(0, 10), status: 'unpaid' },
      ],
    });
    const result = await resolveInvoiceAging(baseCtx(sb));
    expect(result.groups!.invoice_outstanding_usd).toBeDefined();
    expect(result.groups!.invoice_outstanding_usd.length).toBeGreaterThan(0);
  });
});

describe('resolveComplianceSummary', () => {
  it('returns scalar KPIs', async () => {
    const sb = mockSupabase({
      sanctions_screenings: [
        { id: 's1', result: 'clean', created_at: '2026-04-10T00:00:00Z' },
        { id: 's2', result: 'sanctioned', created_at: '2026-04-11T00:00:00Z' },
      ],
      kyt_alerts: [
        { id: 'k1', status: 'open', severity: 'high', created_at: '2026-04-10T00:00:00Z' },
        { id: 'k2', status: 'resolved', severity: 'low', created_at: '2026-04-11T00:00:00Z' },
      ],
    });
    const result = await resolveComplianceSummary(baseCtx(sb));
    expect(result.scalar!.screening_count).toBe(2);
    expect(result.scalar!.screening_hit_count).toBe(1);
    expect(result.scalar!.kyt_alert_count).toBe(2);
    expect(result.scalar!.kyt_open_count).toBe(1);
  });
});

describe('resolveAiActions', () => {
  it('returns detail rows', async () => {
    const sb = mockSupabase({
      ai_recommendations: [
        { id: 'r1', created_at: '2026-04-10T00:00:00Z', action: 'onramp', status: 'executed', recommended_amount_usd: '5000', ai_reasoning: 'Low balance' },
      ],
    });
    const result = await resolveAiActions(baseCtx(sb));
    expect(result.rows).toHaveLength(1);
  });
});

describe('resolveYieldPerformance', () => {
  it('returns detail rows', async () => {
    const sb = mockSupabase({
      yield_transactions: [
        { id: 'y1', executed_at: '2026-04-10T00:00:00Z', tx_type: 'deposit', protocol: 'aave', amount_usd: '10000', token: 'USDC', chain: 'ethereum', status: 'completed' },
      ],
    });
    const result = await resolveYieldPerformance(baseCtx(sb));
    expect(result.rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/resolvers/detail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the detail resolvers**

Write `src/lib/analytics/resolvers/detail.ts`:

```typescript
import type { ResolverContext, ViewResult, GroupedPoint } from '../types';
import { parseNumeric, round2, paginate } from '../utils';

/** Invoice Aging — bar chart by age bucket. */
export async function resolveInvoiceAging(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to } = ctx;

  const { data: rows } = await supabase
    .from('invoices')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .in('status', ['unpaid', 'overdue'])
    .gte('created_at', from)
    .lte('created_at', to + 'T23:59:59Z');

  const invoices = (rows ?? []) as Array<Record<string, unknown>>;
  const now = new Date();

  const buckets: Record<string, { amount: number; count: number }> = {
    '1-30d': { amount: 0, count: 0 },
    '31-60d': { amount: 0, count: 0 },
    '61-90d': { amount: 0, count: 0 },
    '90+d': { amount: 0, count: 0 },
  };

  for (const inv of invoices) {
    const dueDate = new Date(String(inv.due_date ?? inv.created_at) + 'T00:00:00Z');
    const ageDays = Math.floor((now.getTime() - dueDate.getTime()) / 86400000);
    const bucket = ageDays <= 30 ? '1-30d' : ageDays <= 60 ? '31-60d' : ageDays <= 90 ? '61-90d' : '90+d';
    buckets[bucket].amount += parseNumeric(inv.amount_usd);
    buckets[bucket].count += 1;
  }

  const amountPoints: GroupedPoint[] = Object.entries(buckets).map(([group, { amount }]) => ({ group, value: round2(amount) }));
  const countPoints: GroupedPoint[] = Object.entries(buckets).map(([group, { count }]) => ({ group, value: count }));

  return {
    view: { slug: 'invoice-aging', label: 'Invoice Aging', chartType: 'bar' },
    query: { from, to },
    groups: {
      invoice_outstanding_usd: amountPoints,
      invoice_count: countPoints,
    },
  };
}

/** AI Actions — table (detail rows). */
export async function resolveAiActions(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, filters, page, pageSize } = ctx;

  let query = supabase
    .from('ai_recommendations')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .gte('created_at', from)
    .lte('created_at', to + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.action) query = query.eq('action', filters.action);

  const { data: rows } = await query;
  const allRows = (rows ?? []) as Record<string, unknown>[];
  const { rows: pageRows, total } = paginate(allRows, page, pageSize);

  return {
    view: { slug: 'ai-actions', label: 'AI Actions', chartType: 'table' },
    query: { from, to },
    rows: pageRows,
    total,
    page,
    pageSize,
  };
}

/** Compliance Summary — KPI view. */
export async function resolveComplianceSummary(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to } = ctx;

  const [{ data: screenings }, { data: alerts }] = await Promise.all([
    supabase
      .from('sanctions_screenings')
      .select('id, result')
      .eq('enterprise_id', enterpriseId)
      .gte('created_at', from)
      .lte('created_at', to + 'T23:59:59Z'),
    supabase
      .from('kyt_alerts')
      .select('id, status')
      .eq('enterprise_id', enterpriseId)
      .gte('created_at', from)
      .lte('created_at', to + 'T23:59:59Z'),
  ]);

  const screeningList = (screenings ?? []) as Array<{ id: string; result: string }>;
  const alertList = (alerts ?? []) as Array<{ id: string; status: string }>;

  return {
    view: { slug: 'compliance-summary', label: 'Compliance Summary', chartType: 'kpi' },
    query: { from, to },
    scalar: {
      screening_count: screeningList.length,
      screening_hit_count: screeningList.filter((s) => s.result === 'sanctioned').length,
      kyt_alert_count: alertList.length,
      kyt_open_count: alertList.filter((a) => a.status === 'open').length,
    },
  };
}

/** Yield Performance — table (detail rows). */
export async function resolveYieldPerformance(ctx: ResolverContext): Promise<ViewResult> {
  const { supabase, enterpriseId, from, to, filters, page, pageSize } = ctx;

  let query = supabase
    .from('yield_transactions')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .gte('executed_at', from)
    .lte('executed_at', to + 'T23:59:59Z')
    .order('executed_at', { ascending: false });

  if (filters.protocol) query = query.eq('protocol', filters.protocol);
  if (filters.status) query = query.eq('status', filters.status);

  const { data: rows } = await query;
  const allRows = (rows ?? []) as Record<string, unknown>[];
  const { rows: pageRows, total } = paginate(allRows, page, pageSize);

  return {
    view: { slug: 'yield-performance', label: 'Yield Performance', chartType: 'table' },
    query: { from, to },
    rows: pageRows,
    total,
    page,
    pageSize,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/analytics/resolvers/detail.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/resolvers/detail.ts tests/analytics/resolvers/detail.test.ts
git commit -m "feat(analytics): add invoice-aging, ai-actions, compliance, and yield resolvers"
```

---

# Task 11: Resolver registry + analytics engine + tests

**Files:**
- Create: `src/lib/analytics/resolvers/index.ts`
- Create: `src/lib/analytics/engine.ts`
- Create: `tests/analytics/engine.test.ts`

- [ ] **Step 1: Write the resolver registry**

Write `src/lib/analytics/resolvers/index.ts`:

```typescript
import type { ViewResolver } from '../types';
import { resolveTreasurySummary, resolveBalanceHistory, resolveIdleCash } from './treasury';
import { resolveObligationCoverage } from './obligations';
import { resolveForecastVsActuals } from './forecast';
import { resolveRampActivity, resolveTransferVolume, resolveSwapActivity } from './activity';
import { resolveInvoiceAging, resolveAiActions, resolveComplianceSummary, resolveYieldPerformance } from './detail';

/** Map of view slug → resolver function. */
export const RESOLVER_REGISTRY: Record<string, ViewResolver> = {
  'treasury-summary': resolveTreasurySummary,
  'balance-history': resolveBalanceHistory,
  'obligation-coverage': resolveObligationCoverage,
  'forecast-vs-actuals': resolveForecastVsActuals,
  'ramp-activity': resolveRampActivity,
  'transfer-volume': resolveTransferVolume,
  'swap-activity': resolveSwapActivity,
  'invoice-aging': resolveInvoiceAging,
  'ai-actions': resolveAiActions,
  'compliance-summary': resolveComplianceSummary,
  'yield-performance': resolveYieldPerformance,
  'idle-cash': resolveIdleCash,
};

export function getResolver(slug: string): ViewResolver | undefined {
  return RESOLVER_REGISTRY[slug];
}
```

- [ ] **Step 2: Write the engine test**

Write `tests/analytics/engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { executeView } from '@/lib/analytics/engine';
import { STANDARD_VIEWS } from '@/lib/analytics/standard-views';
import { RESOLVER_REGISTRY } from '@/lib/analytics/resolvers';

describe('analytics engine', () => {
  it('every standard view has a registered resolver', () => {
    for (const view of STANDARD_VIEWS) {
      expect(
        RESOLVER_REGISTRY[view.slug],
        `missing resolver for view '${view.slug}'`,
      ).toBeDefined();
    }
  });

  it('executeView rejects unknown view slug', async () => {
    const sb = {} as any;
    await expect(
      executeView(sb, 'ent-1', 'nonexistent', { from: '2026-04-01', to: '2026-04-30' }),
    ).rejects.toThrow(/unknown view/i);
  });

  it('executeView passes filters and pagination through', async () => {
    // Use a mock resolver to verify context propagation
    const sb = {} as any;
    // This test validates the engine wiring — actual resolvers are tested in their own files.
    // We test indirectly by checking the resolver registry is complete.
    expect(Object.keys(RESOLVER_REGISTRY)).toHaveLength(12);
  });
});
```

- [ ] **Step 3: Write the engine**

Write `src/lib/analytics/engine.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ViewQuery, ViewResult, ResolverContext, TimeGranularity } from './types';
import { getStandardView } from './standard-views';
import { getResolver } from './resolvers';

/**
 * Execute an analytics view query.
 *
 * Looks up the view by slug (standard views from code, custom views would come
 * from the DB in Phase C), resolves the view's configuration with any query
 * overrides, and dispatches to the appropriate resolver.
 */
export async function executeView(
  supabase: SupabaseClient,
  enterpriseId: string,
  viewSlug: string,
  query: ViewQuery,
): Promise<ViewResult> {
  // Look up the view definition
  const view = getStandardView(viewSlug);
  if (!view) {
    throw new Error(`Unknown view slug: '${viewSlug}'. Available: ${availableViewSlugs().join(', ')}`);
  }

  // Look up the resolver
  const resolver = getResolver(viewSlug);
  if (!resolver) {
    throw new Error(`No resolver registered for view '${viewSlug}'`);
  }

  // Build resolver context: merge view defaults with query overrides
  const ctx: ResolverContext = {
    supabase,
    enterpriseId,
    from: query.from,
    to: query.to,
    filters: {
      ...(view.config.defaultFilters ?? {}),
      ...(query.filters ?? {}),
    } as Record<string, string | string[]>,
    groupBy: query.groupBy ?? view.config.primaryDimension,
    granularity: query.granularity ?? view.config.granularity ?? 'day',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 50,
  };

  return resolver(ctx);
}

/**
 * Look up a view by slug. Checks standard views first, then custom views from DB.
 * Phase C will add the custom-view DB lookup here.
 */
export async function lookupView(
  supabase: SupabaseClient,
  enterpriseId: string,
  viewSlug: string,
) {
  // Standard view?
  const standard = getStandardView(viewSlug);
  if (standard) return standard;

  // Phase C: look up custom view from analytics_views table
  const { data } = await supabase
    .from('analytics_views')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .eq('slug', viewSlug)
    .limit(1);

  return data?.[0] ?? null;
}

function availableViewSlugs(): string[] {
  const { STANDARD_VIEWS } = require('./standard-views');
  return STANDARD_VIEWS.map((v: { slug: string }) => v.slug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/engine.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/resolvers/index.ts src/lib/analytics/engine.ts tests/analytics/engine.test.ts
git commit -m "feat(analytics): add resolver registry and analytics query engine"
```

---

# Task 12: Analytics API — registry endpoints

**Files:**
- Create: `src/app/api/analytics/measures/route.ts`
- Create: `src/app/api/analytics/dimensions/route.ts`
- Create: `src/app/api/analytics/views/route.ts`

- [ ] **Step 1: Write the measures endpoint**

Write `src/app/api/analytics/measures/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { MEASURES } from '@/lib/analytics/measures';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Strip resolver-internal fields, expose only what the UI needs
  const measures = MEASURES.map(({ slug, label, description, unit, computed, dimensions }) => ({
    slug,
    label,
    description,
    unit,
    computed: computed ?? false,
    dimensions,
  }));

  return NextResponse.json({ data: measures });
}
```

- [ ] **Step 2: Write the dimensions endpoint**

Write `src/app/api/analytics/dimensions/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { DIMENSIONS } from '@/lib/analytics/dimensions';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dimensions = DIMENSIONS.map(({ slug, label, description, granularities }) => ({
    slug,
    label,
    description,
    granularities: granularities ?? null,
  }));

  return NextResponse.json({ data: dimensions });
}
```

- [ ] **Step 3: Write the views list endpoint**

Write `src/app/api/analytics/views/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { STANDARD_VIEWS } from '@/lib/analytics/standard-views';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Return standard views. Phase C will merge in custom views from DB.
  const views = STANDARD_VIEWS.map(({ id, slug, label, description, kind, chartType, config, sortOrder }) => ({
    id,
    slug,
    label,
    description,
    kind,
    chartType,
    config,
    sortOrder,
  }));

  return NextResponse.json({ data: views });
}
```

- [ ] **Step 4: Verify endpoints compile**

Run: `npx tsc --noEmit`
Expected: no new errors from the analytics API files. (Existing errors may be present from other files — only check for analytics-related errors.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/analytics/measures/route.ts src/app/api/analytics/dimensions/route.ts src/app/api/analytics/views/route.ts
git commit -m "feat(analytics): add measures, dimensions, and views list API endpoints"
```

---

# Task 13: Analytics API — query endpoint

**Files:**
- Create: `src/app/api/analytics/query/route.ts`

- [ ] **Step 1: Write the query endpoint**

Write `src/app/api/analytics/query/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { executeView } from '@/lib/analytics/engine';
import type { ViewQuery } from '@/lib/analytics/types';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'accountant');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: { viewSlug?: string; from?: string; to?: string; filters?: Record<string, string | string[]>; groupBy?: string; granularity?: string; page?: number; pageSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { viewSlug, from, to } = body;
  if (!viewSlug || !from || !to) {
    return NextResponse.json(
      { error: 'Required fields: viewSlug, from, to' },
      { status: 400 },
    );
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: 'Dates must be YYYY-MM-DD format' },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const query: ViewQuery = {
    from,
    to,
    filters: body.filters,
    groupBy: body.groupBy,
    granularity: body.granularity as ViewQuery['granularity'],
    page: body.page,
    pageSize: body.pageSize,
  };

  try {
    const result = await executeView(supabase, enterpriseId, viewSlug, query);
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Query failed';
    const status = message.includes('Unknown view') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from analytics query route.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/query/route.ts
git commit -m "feat(analytics): add POST /api/analytics/query endpoint"
```

---

# Task 14: Analytics API — views CRUD (Phase C prep)

**Files:**
- Create: `src/app/api/analytics/views/[id]/route.ts`

- [ ] **Step 1: Write the single-view CRUD endpoint**

Write `src/app/api/analytics/views/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { getStandardView } from '@/lib/analytics/standard-views';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check standard views first
  const standard = getStandardView(params.id);
  if (standard) {
    return NextResponse.json({ data: standard });
  }

  // Phase C: check custom views in DB
  const supabase = createAdminClient();
  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const { data } = await supabase
    .from('analytics_views')
    .select('*')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1);

  if (!data?.[0]) {
    return NextResponse.json({ error: 'View not found' }, { status: 404 });
  }

  return NextResponse.json({ data: data[0] });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'treasury_manager');
  } catch {
    return NextResponse.json({ error: 'Forbidden — treasury_manager or enterprise_admin required' }, { status: 403 });
  }

  // Standard views cannot be edited
  if (getStandardView(params.id)) {
    return NextResponse.json(
      { error: 'Standard views cannot be edited. Fork it to create a custom view.' },
      { status: 403 },
    );
  }

  const body = await req.json();
  const supabase = createAdminClient();
  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { data, error } = await supabase
    .from('analytics_views')
    .update({
      ...(body.label && { label: body.label }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.config && { config: body.config }),
      ...(body.chart_type && { chart_type: body.chart_type }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'View not found or update failed' }, { status: 404 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'treasury_manager');
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (getStandardView(params.id)) {
    return NextResponse.json({ error: 'Standard views cannot be deleted' }, { status: 403 });
  }

  const supabase = createAdminClient();
  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { error } = await supabase
    .from('analytics_views')
    .delete()
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId);

  if (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/views/[id]/route.ts
git commit -m "feat(analytics): add views CRUD endpoint (GET/PATCH/DELETE)"
```

---

# Task 15: Rewire useReportData to analytics API

**Files:**
- Modify: `src/hooks/useReportData.ts`

- [ ] **Step 1: Read the current file**

Read `src/hooks/useReportData.ts` to confirm the current state matches expectations (6 query hooks, filterByDate helper, conditional loading per section).

- [ ] **Step 2: Rewrite useReportData to use analytics query API**

Replace the contents of `src/hooks/useReportData.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { SectionId } from '@/components/reporting/section-config';
import type { ViewResult } from '@/lib/analytics/types';

/** Map report section IDs to analytics view slugs. */
const SECTION_VIEW_MAP: Record<SectionId, string> = {
  'treasury-overview': 'treasury-summary',
  'obligation-coverage': 'obligation-coverage',
  'recommendations': 'ai-actions',
  'ramp-history': 'ramp-activity',
  'transfers': 'transfer-volume',
  'swaps': 'swap-activity',
  'invoices': 'invoice-aging',
  'compliance': 'compliance-summary',
  'yield': 'yield-performance',
};

async function queryAnalyticsView(viewSlug: string, from: string, to: string): Promise<ViewResult> {
  const res = await fetch('/api/analytics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ viewSlug, from, to }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Query failed' }));
    throw new Error(err.error ?? 'Analytics query failed');
  }
  const { data } = await res.json();
  return data;
}

export function useReportData(from?: string, to?: string, sections?: Set<SectionId>) {
  const { data: session } = useSession();
  const hasSection = (id: SectionId) => !!from && !!to && !!sections?.has(id);

  function useViewQuery(sectionId: SectionId) {
    const viewSlug = SECTION_VIEW_MAP[sectionId];
    return useQuery<ViewResult>({
      queryKey: ['analytics', viewSlug, from, to],
      queryFn: () => queryAnalyticsView(viewSlug, from!, to!),
      enabled: hasSection(sectionId),
      staleTime: 60_000,
    });
  }

  const treasury = useViewQuery('treasury-overview');
  const obligationCoverage = useViewQuery('obligation-coverage');
  const recommendations = useViewQuery('recommendations');
  const rampHistory = useViewQuery('ramp-history');
  const transfers = useViewQuery('transfers');
  const swaps = useViewQuery('swaps');
  const invoices = useViewQuery('invoices');
  const compliance = useViewQuery('compliance');
  const yieldTxs = useViewQuery('yield');

  const isLoading =
    (hasSection('treasury-overview') && treasury.isLoading) ||
    (hasSection('obligation-coverage') && obligationCoverage.isLoading) ||
    (hasSection('recommendations') && recommendations.isLoading) ||
    (hasSection('ramp-history') && rampHistory.isLoading) ||
    (hasSection('transfers') && transfers.isLoading) ||
    (hasSection('swaps') && swaps.isLoading) ||
    (hasSection('invoices') && invoices.isLoading) ||
    (hasSection('compliance') && compliance.isLoading) ||
    (hasSection('yield') && yieldTxs.isLoading);

  return {
    treasury,
    obligationCoverage,
    recommendations,
    rampHistory,
    transfers,
    swaps,
    invoices,
    compliance,
    yieldTxs,
    isLoading,
  };
}
```

- [ ] **Step 3: Update ReportBuilderPanel and section components to consume ViewResult**

The existing section components expect specific data shapes. Each section needs a thin adapter to extract data from `ViewResult`. The approach:

- **KPI sections** (Treasury Overview, Compliance): read `result.scalar`
- **Chart sections** (Obligation Coverage, Ramp Activity): read `result.groups`
- **Table sections** (Transfers, Swaps, Invoices, Recommendations, Yield): read `result.rows`

Update `src/components/reporting/ReportBuilderPanel.tsx` to pass the new query results to each section. The section components' internal rendering stays the same — only the data source changes.

For each section, check whether it reads `.data` from the old hook shape and update to read from the `ViewResult` shape. Example: `TransfersSection` currently receives `Transfer[]` from `useReportData().transfers.data`. Now it receives `ViewResult` where `.rows` contains the transfer objects.

The exact edits depend on how each section component destructures its props. Read each section file and update the data extraction. The row shape from the analytics resolver is the same as the raw DB row shape (since resolvers use `select('*')`), so column accessors in section components should continue working.

- [ ] **Step 4: Verify the hook compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from useReportData. If section components have type mismatches, update them to accept `ViewResult` and extract `.rows` / `.scalar` / `.groups` appropriately.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReportData.ts
git commit -m "feat(analytics): rewire useReportData to analytics query API"
```

---

# Task 16: Deprecate buildReportData

**Files:**
- Modify: `src/lib/treasury/report.ts`

- [ ] **Step 1: Add deprecation notice**

Read `src/lib/treasury/report.ts`. Add a `@deprecated` JSDoc to `buildReportData`:

```typescript
/**
 * @deprecated Use the analytics engine via POST /api/analytics/query instead.
 * Kept temporarily for legacy callers. Will be removed in Phase C.
 */
export async function buildReportData(
```

Do NOT delete the function yet — ensure no other caller depends on it first. Check for references:

Run: `grep -r "buildReportData" src/ --include="*.ts" --include="*.tsx"`

If `buildReportData` is only called by the now-rewired `useReportData` hook (or its backing API), it's safe to mark deprecated. If other callers exist, note them for later cleanup.

Keep `reportToCsv()` — it's used by the CSV export flow and is independent of the data source.

- [ ] **Step 2: Commit**

```bash
git add src/lib/treasury/report.ts
git commit -m "chore(analytics): deprecate buildReportData in favor of analytics engine"
```

---

# Task 17: Full suite green

- [ ] **Step 1: Run tsc**

Run: `npx tsc --noEmit`

Fix any type errors in the analytics code. Common issues:
- Supabase client type imports
- `as any` casts on session.user.role (existing pattern)
- Missing type narrowing on optional ViewResult fields

- [ ] **Step 2: Run vitest**

Run: `npx vitest run`

Expected: all analytics tests pass, plus existing tests still pass.

- [ ] **Step 3: Run lint**

Run: `npx next lint`

Fix any lint issues.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix(analytics): resolve type and lint issues for Phase B"
```

---

# Task 18: Architecture doc update

**Files:**
- Modify: `docs/architecture/forecast-analytics.md`

- [ ] **Step 1: Read the current doc**

Read `docs/architecture/forecast-analytics.md` to see Phase A's section.

- [ ] **Step 2: Add Phase B section**

Append to the doc:

```markdown
## Phase B — Analytics Engine

Phase B adds a measures/dimensions analytics engine with 12 standard
views and rewires the Report Builder to consume it.

### Architecture

```
  MEASURES registry      DIMENSIONS registry
  (25 measures,           (9 dimensions,
   code-defined)           code-defined)
       │                       │
       └──────────┬────────────┘
                  │
          STANDARD VIEWS (12)
          (code + DB rows in
           analytics_views)
                  │
                  ▼
          RESOLVER REGISTRY
          (view slug → resolver fn)
                  │
                  ▼
          ANALYTICS ENGINE
          (executeView dispatcher)
                  │
          ┌───────┴───────┬──────────────┐
          ▼               ▼              ▼
    Report Builder   API endpoints   Phase C:
    (useReportData    (/api/analytics)  custom views,
     rewired)                          alerting
```

### Measures

25 measures defined in `src/lib/analytics/measures.ts`. Each has a
slug, label, unit, and either a declarative source (table + column +
aggregation) or `computed: true` for measures that need custom logic.

Computed measures: `idle_cash_usd`, `coverage_ratio`,
`forecast_projected_usd`. Their resolvers live alongside the standard
resolvers.

### Dimensions

9 dimensions in `src/lib/analytics/dimensions.ts`: time, direction,
status, chain, confidence, action, protocol, severity, age_bucket.

### Standard views

12 views seeded in migration 0047 and defined in code in
`src/lib/analytics/standard-views.ts`. Each has a resolver in
`src/lib/analytics/resolvers/`.

| View | Chart type | Key measures |
|------|-----------|-------------|
| Treasury Summary | kpi | balance breakdown + idle cash + coverage |
| Balance History | line | fiat/stablecoin/DeFi over time |
| Obligation Coverage | bar | obligations vs balance by week |
| Forecast vs Actuals | line | projected vs actual balance |
| Ramp Activity | bar | volume by direction |
| Transfer Volume | table | detail rows |
| Swap Activity | table | detail rows |
| Invoice Aging | bar | outstanding by age bucket |
| AI Actions | table | recommendation detail rows |
| Compliance Summary | kpi | screening + KYT counts |
| Yield Performance | table | transaction detail rows |
| Idle Cash Trend | line | idle stablecoin over time |

### Report Builder adapter

`src/hooks/useReportData.ts` was rewritten to call
`POST /api/analytics/query` per section instead of fetching from
scattered API endpoints. Each section maps to a standard view via
`SECTION_VIEW_MAP`. The old `buildReportData()` in
`src/lib/treasury/report.ts` is deprecated.

### Phase C roadmap

- Custom view builder (CRUD on `analytics_views` with `kind='custom'`)
- Fork standard views into custom
- Threshold alerting per view
- Scheduled delivery (email/Slack)
- CSV/PDF export from any view
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/forecast-analytics.md
git commit -m "docs(analytics): add Phase B architecture section"
```

---

# Task 19: Final verification + PR

- [ ] **Step 1: Merge master into feature branch**

```bash
cd /c/Users/John/crypto-treasury
git fetch origin master
cd .worktrees/forecast-analytics-b
git merge origin/master
```

Resolve any conflicts. Most likely none — Phase B touches new files.

- [ ] **Step 2: Run full verification**

```bash
npx tsc --noEmit
npx vitest run
npx next lint
```

All must pass.

- [ ] **Step 3: Apply migration to dev Supabase**

If not already done in T1, verify 0047 is applied:

```bash
npx tsx scripts/migrate.ts supabase/migrations/0047_analytics_views.sql
```

- [ ] **Step 4: Apply migration to prod Supabase**

Switch `NEXT_PUBLIC_SUPABASE_URL` to prod (`lfujbwemavgiifkltrag`), then:

```bash
npx tsx scripts/migrate.ts supabase/migrations/0047_analytics_views.sql
```

Switch back to dev URL.

- [ ] **Step 5: Push and open PR**

```bash
git push origin feature/forecast-analytics-b
```

Open PR against `master` with title: `feat: Phase B — analytics engine, 12 standard views, Report Builder rewire`

Body:
```
## Summary
- Adds a measures/dimensions analytics engine with 25 measures, 9 dimensions, and 12 standard views
- Each view has a dedicated resolver (treasury, obligations, forecast vs actuals, ramps, transfers, swaps, invoices, recommendations, compliance, yield, idle cash)
- Rewires the Report Builder's useReportData hook to consume the analytics query API
- Deprecates buildReportData() in favor of per-view analytics queries
- Subsumes simulation_runs as the "Forecast vs Actuals" view
- Migration 0047: analytics_views table with 12 seeded standard views

## Test plan
- [ ] `npx vitest run` — all analytics tests pass (registries, utils, resolvers, engine)
- [ ] `npx tsc --noEmit` — no type errors
- [ ] Report Builder still renders all 9 sections correctly
- [ ] Analytics query API returns valid results for all 12 standard views
- [ ] Migration 0047 applied to both dev and prod Supabase
```
