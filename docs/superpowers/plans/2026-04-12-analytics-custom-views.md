# Analytics Custom Views + Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Analytics page at `/analytics` with pinned views, browsable view list, full-page drill-in, fork-to-customize flow, and per-view + page-level CSV/PDF export.

**Architecture:** New `/analytics` route with a pinned+browse hybrid layout. Treasury Summary KPI banner always at top, up to 4 user-pinned chart views rendered inline, then a compact list of all standard + custom views. Clicking drills into `/analytics/[slug]` with full-width chart/table + filters + export. Fork modal lets users copy a standard view with custom filters/display options, stored as `kind='custom'` in `analytics_views`. Pin preferences stored in a new `analytics_pin_preferences` table. Export uses existing `src/lib/export/` utilities with new column-mapping helpers per chart type.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres + RLS), TypeScript, TanStack Query, Recharts, Tailwind CSS, existing shared UI components (FilterBar, TablePagination, Dialog), existing export utilities (csv.ts, pdf.tsx).

**Branch:** `feature/analytics-custom-views` (worktree at `.worktrees/analytics-custom-views`)

**Design spec:** `docs/superpowers/specs/2026-04-12-analytics-custom-views-design.md`

---

## File Structure

**New files:**
- `supabase/migrations/0048_analytics_pins_and_fork.sql` — pin preferences table + `forked_from` column on analytics_views
- `src/hooks/useViewQuery.ts` — React Query wrapper for `POST /api/analytics/query`
- `src/hooks/useAnalyticsViews.ts` — fetches standard + custom views list
- `src/hooks/useAnalyticsPins.ts` — fetches/updates pin preferences
- `src/components/analytics/KpiBanner.tsx` — Treasury Summary KPI row
- `src/components/analytics/ViewChart.tsx` — Recharts line/bar renderer from ViewResult
- `src/components/analytics/ViewTable.tsx` — data table renderer from ViewResult rows
- `src/components/analytics/PinnedViewCard.tsx` — pinned view card with mini chart + export
- `src/components/analytics/ViewListRow.tsx` — row in all-views list with quick actions
- `src/components/analytics/ForkViewModal.tsx` — fork/create modal with preview
- `src/components/analytics/AnalyticsPageClient.tsx` — main list page client component
- `src/components/analytics/AnalyticsDrillIn.tsx` — full-page drill-in client component
- `src/components/analytics/export-helpers.ts` — CSV/PDF column definitions per chart type
- `src/app/(app)/analytics/page.tsx` — list page server shell
- `src/app/(app)/analytics/[slug]/page.tsx` — drill-in page server shell
- `src/app/api/analytics/pins/route.ts` — GET/PUT pin preferences
- `src/app/api/analytics/export/report/route.ts` — page-level pinned-views PDF
- `tests/analytics/export-helpers.test.ts` — export column mapping tests

**Modified files:**
- `src/components/layout/Sidebar.tsx` — add Analytics nav item under Records
- `src/app/api/analytics/views/route.ts` — extend GET to merge custom views, add POST for create
- `docs/architecture/forecast-analytics.md` — add Phase C-1 section

---

## Testing strategy

- **Pure unit tests** (vitest): export column mapping helpers (pure functions, no DB).
- **Type-checking** (tsc --noEmit): primary gate for all React components and API routes.
- **Visual testing**: run dev server, navigate to `/analytics`, verify page renders, drill-in works, fork modal opens, export downloads. Manual verification before PR.

---

# Task 1: Migration 0048 — pin preferences + forked_from

**Files:**
- Create: `supabase/migrations/0048_analytics_pins_and_fork.sql`

- [ ] **Step 1: Write the migration SQL**

Write `supabase/migrations/0048_analytics_pins_and_fork.sql`:

```sql
-- ============================================================
-- 0048_analytics_pins_and_fork.sql
-- Pin preferences for the Analytics page + fork tracking.
-- ============================================================

-- Pin preferences: which views a user has pinned on the Analytics page.
-- Treasury Summary is always rendered at top regardless of this table.
CREATE TABLE IF NOT EXISTS analytics_pin_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  pinned_slugs  TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, enterprise_id)
);

ALTER TABLE analytics_pin_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_pin_preferences" ON analytics_pin_preferences
  FOR ALL USING (user_id = auth.uid());

-- Fork tracking: link custom views back to their source.
ALTER TABLE analytics_views
  ADD COLUMN IF NOT EXISTS forked_from UUID REFERENCES analytics_views(id) ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply to dev Supabase**

```bash
export $(grep -v '^#' .env.local | xargs) 2>/dev/null
npx tsx scripts/migrate.ts supabase/migrations/0048_analytics_pins_and_fork.sql
```

Expected: migration applies successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0048_analytics_pins_and_fork.sql
git commit -m "feat(analytics): add pin preferences table and forked_from column (0048)"
```

---

# Task 2: Pin preferences API

**Files:**
- Create: `src/app/api/analytics/pins/route.ts`

- [ ] **Step 1: Write the pins API**

Write `src/app/api/analytics/pins/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const MAX_PINS = 4;
const DEFAULT_PINS = ['balance-history', 'obligation-coverage'];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ data: { pinnedSlugs: DEFAULT_PINS } });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('analytics_pin_preferences')
    .select('pinned_slugs')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1);

  const pinnedSlugs = data?.[0]?.pinned_slugs ?? DEFAULT_PINS;
  return NextResponse.json({ data: { pinnedSlugs } });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: { slugs?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slugs = body.slugs;
  if (!Array.isArray(slugs)) {
    return NextResponse.json({ error: 'slugs must be an array' }, { status: 400 });
  }
  if (slugs.length > MAX_PINS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PINS} pinned views allowed` },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('analytics_pin_preferences')
    .upsert(
      {
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        pinned_slugs: slugs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,enterprise_id' },
    );

  if (error) {
    return NextResponse.json({ error: 'Failed to update pins' }, { status: 500 });
  }

  return NextResponse.json({ data: { pinnedSlugs: slugs } });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/app/api/analytics/pins/route.ts` (or full project tsc if needed)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/pins/route.ts
git commit -m "feat(analytics): add GET/PUT /api/analytics/pins endpoint"
```

---

# Task 3: Extend views API — GET merges custom views, POST creates

**Files:**
- Modify: `src/app/api/analytics/views/route.ts`

- [ ] **Step 1: Read the current file**

Read `src/app/api/analytics/views/route.ts` to see the current GET-only implementation.

- [ ] **Step 2: Extend GET to merge custom views and add POST handler**

Replace the contents of `src/app/api/analytics/views/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { STANDARD_VIEWS } from '@/lib/analytics/standard-views';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const standardViews = STANDARD_VIEWS.map(
    ({ id, slug, label, description, kind, chartType, config, sortOrder }) => ({
      id, slug, label, description, kind, chartType, config, sortOrder,
    }),
  );

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ data: standardViews });
  }

  // Fetch custom views for this enterprise
  const supabase = createAdminClient();
  const { data: customRows } = await supabase
    .from('analytics_views')
    .select('id, slug, label, description, kind, chart_type, config, sort_order, forked_from, created_at, updated_at')
    .eq('enterprise_id', enterpriseId)
    .eq('kind', 'custom')
    .order('created_at', { ascending: true });

  const customViews = (customRows ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    label: r.label,
    description: r.description,
    kind: r.kind as 'custom',
    chartType: r.chart_type,
    config: r.config,
    sortOrder: r.sort_order,
    forkedFrom: r.forked_from,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json({ data: [...standardViews, ...customViews] });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    requireRole(session.user.role as any, 'treasury_manager');
  } catch {
    return NextResponse.json({ error: 'Forbidden — treasury_manager or enterprise_admin required' }, { status: 403 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: {
    label?: string;
    slug?: string;
    chartType?: string;
    config?: Record<string, unknown>;
    forkedFrom?: string;
    description?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.label || !body.slug) {
    return NextResponse.json({ error: 'label and slug are required' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('analytics_views')
    .insert({
      enterprise_id: enterpriseId,
      slug: body.slug,
      label: body.label,
      description: body.description ?? null,
      kind: 'custom',
      chart_type: body.chartType ?? 'table',
      config: body.config ?? {},
      forked_from: body.forkedFrom ?? null,
      sort_order: 100, // custom views sort after standard
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A view with this slug already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create view' }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/analytics/views/route.ts
git commit -m "feat(analytics): extend views API with custom view listing and POST create"
```

---

# Task 4: React Query hooks (useViewQuery, useAnalyticsViews, useAnalyticsPins)

**Files:**
- Create: `src/hooks/useViewQuery.ts`
- Create: `src/hooks/useAnalyticsViews.ts`
- Create: `src/hooks/useAnalyticsPins.ts`

- [ ] **Step 1: Write useViewQuery**

Write `src/hooks/useViewQuery.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import type { ViewResult, TimeGranularity } from '@/lib/analytics/types';

interface ViewQueryOptions {
  viewSlug: string;
  from: string;
  to: string;
  filters?: Record<string, string | string[]>;
  granularity?: TimeGranularity;
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}

async function fetchViewQuery(opts: Omit<ViewQueryOptions, 'enabled'>): Promise<ViewResult> {
  const res = await fetch('/api/analytics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      viewSlug: opts.viewSlug,
      from: opts.from,
      to: opts.to,
      filters: opts.filters,
      granularity: opts.granularity,
      page: opts.page,
      pageSize: opts.pageSize,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Query failed' }));
    throw new Error(err.error ?? 'Analytics query failed');
  }
  const { data } = await res.json();
  return data;
}

export function useViewQuery(opts: ViewQueryOptions) {
  return useQuery<ViewResult>({
    queryKey: ['analytics-query', opts.viewSlug, opts.from, opts.to, opts.filters, opts.granularity, opts.page, opts.pageSize],
    queryFn: () => fetchViewQuery(opts),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Write useAnalyticsViews**

Write `src/hooks/useAnalyticsViews.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';

export interface AnalyticsViewListItem {
  id: string;
  slug: string;
  label: string;
  description: string;
  kind: 'standard' | 'custom';
  chartType: string;
  config: Record<string, unknown>;
  sortOrder: number;
  forkedFrom?: string;
  createdAt?: string;
  updatedAt?: string;
}

async function fetchViews(): Promise<AnalyticsViewListItem[]> {
  const res = await fetch('/api/analytics/views');
  if (!res.ok) return [];
  const { data } = await res.json();
  return data ?? [];
}

export function useAnalyticsViews() {
  return useQuery<AnalyticsViewListItem[]>({
    queryKey: ['analytics-views'],
    queryFn: fetchViews,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Write useAnalyticsPins**

Write `src/hooks/useAnalyticsPins.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const DEFAULT_PINS = ['balance-history', 'obligation-coverage'];

async function fetchPins(): Promise<string[]> {
  const res = await fetch('/api/analytics/pins');
  if (!res.ok) return DEFAULT_PINS;
  const { data } = await res.json();
  return data?.pinnedSlugs ?? DEFAULT_PINS;
}

async function updatePins(slugs: string[]): Promise<string[]> {
  const res = await fetch('/api/analytics/pins', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Update failed' }));
    throw new Error(err.error ?? 'Failed to update pins');
  }
  const { data } = await res.json();
  return data.pinnedSlugs;
}

export function useAnalyticsPins() {
  const queryClient = useQueryClient();

  const query = useQuery<string[]>({
    queryKey: ['analytics-pins'],
    queryFn: fetchPins,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: updatePins,
    onSuccess: (newPins) => {
      queryClient.setQueryData(['analytics-pins'], newPins);
    },
  });

  const togglePin = (slug: string) => {
    const current = query.data ?? DEFAULT_PINS;
    const isPinned = current.includes(slug);
    if (isPinned) {
      mutation.mutate(current.filter((s) => s !== slug));
    } else if (current.length < 4) {
      mutation.mutate([...current, slug]);
    }
  };

  return {
    pins: query.data ?? DEFAULT_PINS,
    isLoading: query.isLoading,
    togglePin,
    isPinned: (slug: string) => (query.data ?? DEFAULT_PINS).includes(slug),
    isPinning: mutation.isPending,
  };
}
```

- [ ] **Step 4: Verify all compile**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useViewQuery.ts src/hooks/useAnalyticsViews.ts src/hooks/useAnalyticsPins.ts
git commit -m "feat(analytics): add useViewQuery, useAnalyticsViews, useAnalyticsPins hooks"
```

---

# Task 5: Export helpers + tests

**Files:**
- Create: `src/components/analytics/export-helpers.ts`
- Create: `tests/analytics/export-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Write `tests/analytics/export-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { viewResultToCsvColumns, viewResultToCsvRows } from '@/components/analytics/export-helpers';
import type { ViewResult } from '@/lib/analytics/types';

describe('viewResultToCsvColumns (kpi)', () => {
  const kpiResult: ViewResult = {
    view: { slug: 'treasury-summary', label: 'Treasury Summary', chartType: 'kpi' },
    query: { from: '2026-04-01', to: '2026-04-30' },
    scalar: { total_balance_usd: 2400000, fiat_balance_usd: 1200000, idle_cash_usd: 320000 },
  };

  it('produces one column per scalar key', () => {
    const cols = viewResultToCsvColumns(kpiResult);
    expect(cols).toHaveLength(3);
    expect(cols[0].header).toBe('total_balance_usd');
  });

  it('produces a single row with the scalar values', () => {
    const rows = viewResultToCsvRows(kpiResult);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_balance_usd).toBe(2400000);
  });
});

describe('viewResultToCsvColumns (line)', () => {
  const lineResult: ViewResult = {
    view: { slug: 'balance-history', label: 'Balance History', chartType: 'line' },
    query: { from: '2026-04-01', to: '2026-04-10' },
    series: {
      fiat_balance_usd: [
        { date: '2026-04-01', value: 500000 },
        { date: '2026-04-02', value: 510000 },
      ],
      stablecoin_balance_usd: [
        { date: '2026-04-01', value: 200000 },
        { date: '2026-04-02', value: 195000 },
      ],
    },
  };

  it('produces date + one column per series', () => {
    const cols = viewResultToCsvColumns(lineResult);
    expect(cols[0].header).toBe('Date');
    expect(cols[1].header).toBe('fiat_balance_usd');
    expect(cols[2].header).toBe('stablecoin_balance_usd');
  });

  it('produces one row per date', () => {
    const rows = viewResultToCsvRows(lineResult);
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-04-01');
    expect(rows[0].fiat_balance_usd).toBe(500000);
  });
});

describe('viewResultToCsvColumns (bar)', () => {
  const barResult: ViewResult = {
    view: { slug: 'ramp-activity', label: 'Ramp Activity', chartType: 'bar' },
    query: { from: '2026-04-01', to: '2026-04-30' },
    groups: {
      ramp_volume_usd: [
        { group: 'onramp', value: 70000 },
        { group: 'offramp', value: 30000 },
      ],
      ramp_count: [
        { group: 'onramp', value: 5 },
        { group: 'offramp', value: 3 },
      ],
    },
  };

  it('produces group + one column per grouped measure', () => {
    const cols = viewResultToCsvColumns(barResult);
    expect(cols[0].header).toBe('Group');
    expect(cols[1].header).toBe('ramp_volume_usd');
  });

  it('produces one row per group', () => {
    const rows = viewResultToCsvRows(barResult);
    expect(rows).toHaveLength(2);
    expect(rows[0].group).toBe('onramp');
    expect(rows[0].ramp_volume_usd).toBe(70000);
  });
});

describe('viewResultToCsvColumns (table)', () => {
  const tableResult: ViewResult = {
    view: { slug: 'transfer-volume', label: 'Transfer Volume', chartType: 'table' },
    query: { from: '2026-04-01', to: '2026-04-30' },
    rows: [
      { id: 't1', created_at: '2026-04-10T00:00:00Z', amount_usd: 1000, status: 'completed', chain: 'ethereum' },
      { id: 't2', created_at: '2026-04-11T00:00:00Z', amount_usd: 2000, status: 'pending', chain: 'solana' },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  };

  it('produces one column per row key', () => {
    const cols = viewResultToCsvColumns(tableResult);
    expect(cols.map((c) => c.header)).toContain('id');
    expect(cols.map((c) => c.header)).toContain('amount_usd');
  });

  it('returns the rows as-is', () => {
    const rows = viewResultToCsvRows(tableResult);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analytics/export-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the export helpers**

Write `src/components/analytics/export-helpers.ts`:

```typescript
import type { ExportColumn } from '@/lib/export';
import type { ViewResult, TimeSeriesPoint, GroupedPoint } from '@/lib/analytics/types';

type Row = Record<string, unknown>;

/**
 * Build ExportColumn definitions from a ViewResult, based on chart type.
 * - kpi: one column per scalar key
 * - line: date column + one column per series
 * - bar: group column + one column per grouped measure
 * - table: one column per row key (auto-detected from first row)
 */
export function viewResultToCsvColumns(result: ViewResult): ExportColumn<Row>[] {
  const chartType = result.view.chartType;

  if (chartType === 'kpi' && result.scalar) {
    return Object.keys(result.scalar).map((key) => ({
      header: key,
      accessor: (row: Row) => String(row[key] ?? ''),
    }));
  }

  if (chartType === 'line' && result.series) {
    const seriesKeys = Object.keys(result.series);
    return [
      { header: 'Date', accessor: (row: Row) => String(row.date ?? '') },
      ...seriesKeys.map((key) => ({
        header: key,
        accessor: (row: Row) => String(row[key] ?? ''),
      })),
    ];
  }

  if (chartType === 'bar' && result.groups) {
    const groupKeys = Object.keys(result.groups);
    return [
      { header: 'Group', accessor: (row: Row) => String(row.group ?? '') },
      ...groupKeys.map((key) => ({
        header: key,
        accessor: (row: Row) => String(row[key] ?? ''),
      })),
    ];
  }

  if (chartType === 'table' && result.rows && result.rows.length > 0) {
    const keys = Object.keys(result.rows[0]);
    return keys.map((key) => ({
      header: key,
      accessor: (row: Row) => String(row[key] ?? ''),
    }));
  }

  return [];
}

/**
 * Flatten a ViewResult into an array of plain row objects for CSV/PDF export.
 */
export function viewResultToCsvRows(result: ViewResult): Row[] {
  const chartType = result.view.chartType;

  if (chartType === 'kpi' && result.scalar) {
    return [{ ...result.scalar }];
  }

  if (chartType === 'line' && result.series) {
    const seriesKeys = Object.keys(result.series);
    if (seriesKeys.length === 0) return [];
    const dates = result.series[seriesKeys[0]].map((p) => p.date);
    return dates.map((date, i) => {
      const row: Row = { date };
      for (const key of seriesKeys) {
        row[key] = result.series![key][i]?.value ?? 0;
      }
      return row;
    });
  }

  if (chartType === 'bar' && result.groups) {
    const groupKeys = Object.keys(result.groups);
    if (groupKeys.length === 0) return [];
    const groups = result.groups[groupKeys[0]].map((p) => p.group);
    return groups.map((group, i) => {
      const row: Row = { group };
      for (const key of groupKeys) {
        row[key] = result.groups![key][i]?.value ?? 0;
      }
      return row;
    });
  }

  if (chartType === 'table' && result.rows) {
    return result.rows as Row[];
  }

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analytics/export-helpers.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/export-helpers.ts tests/analytics/export-helpers.test.ts
git commit -m "feat(analytics): add CSV/PDF export helpers with column mapping per chart type"
```

---

# Task 6: KpiBanner + ViewChart + ViewTable components

These three are the rendering primitives that the page and drill-in reuse.

**Files:**
- Create: `src/components/analytics/KpiBanner.tsx`
- Create: `src/components/analytics/ViewChart.tsx`
- Create: `src/components/analytics/ViewTable.tsx`

- [ ] **Step 1: Write KpiBanner**

Write `src/components/analytics/KpiBanner.tsx`:

```tsx
'use client';

import type { ViewResult } from '@/lib/analytics/types';

const LABELS: Record<string, string> = {
  total_balance_usd: 'Total Balance',
  fiat_balance_usd: 'Fiat',
  stablecoin_balance_usd: 'Stablecoin',
  defi_balance_usd: 'DeFi',
  idle_cash_usd: 'Idle Cash',
  coverage_ratio: 'Coverage',
};

function formatValue(key: string, value: number): string {
  if (key === 'coverage_ratio') return `${value.toFixed(1)}x`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function valueColor(key: string, value: number): string {
  if (key === 'idle_cash_usd') return 'text-teal-400';
  if (key === 'coverage_ratio') return value >= 1.5 ? 'text-green-400' : value >= 1 ? 'text-yellow-400' : 'text-red-400';
  return 'text-white';
}

interface KpiBannerProps {
  result: ViewResult;
}

export function KpiBanner({ result }: KpiBannerProps) {
  const scalar = result.scalar ?? {};
  const keys = Object.keys(scalar);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-card p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Treasury Summary</span>
        <span className="text-xs text-muted-foreground/60">pinned</span>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {keys.map((key) => (
          <div key={key}>
            <div className="text-xs text-muted-foreground">{LABELS[key] ?? key}</div>
            <div className={`text-lg font-semibold ${valueColor(key, scalar[key])}`}>
              {formatValue(key, scalar[key])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write ViewChart**

Write `src/components/analytics/ViewChart.tsx`:

```tsx
'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { ViewResult } from '@/lib/analytics/types';

const COLORS = [
  'hsl(182, 58%, 45%)', // teal
  '#f59e0b',            // amber
  '#8b5cf6',            // purple
  '#ef4444',            // red
  '#22c55e',            // green
];

interface ViewChartProps {
  result: ViewResult;
  height?: number;
}

export function ViewChart({ result, height = 300 }: ViewChartProps) {
  const { chartType } = result.view;

  if (chartType === 'line' && result.series) {
    return <LineChartView result={result} height={height} />;
  }

  if (chartType === 'bar' && result.groups) {
    return <BarChartView result={result} height={height} />;
  }

  return null;
}

function LineChartView({ result, height }: { result: ViewResult; height: number }) {
  const series = result.series!;
  const seriesKeys = Object.keys(series);
  if (seriesKeys.length === 0) return null;

  // Merge all series into unified data array keyed by date
  const dates = series[seriesKeys[0]].map((p) => p.date);
  const data = dates.map((date, i) => {
    const point: Record<string, unknown> = { date };
    for (const key of seriesKeys) {
      point[key] = series[key][i]?.value ?? 0;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Legend />
        {seriesKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function BarChartView({ result, height }: { result: ViewResult; height: number }) {
  const groups = result.groups!;
  const groupKeys = Object.keys(groups);
  if (groupKeys.length === 0) return null;

  // Merge all groups into unified data array keyed by group name
  const groupNames = groups[groupKeys[0]].map((p) => p.group);
  const data = groupNames.map((group, i) => {
    const point: Record<string, unknown> = { group };
    for (const key of groupKeys) {
      point[key] = groups[key][i]?.value ?? 0;
    }
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="group" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
        />
        <Legend />
        {groupKeys.map((key, i) => (
          <Bar key={key} dataKey={key} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Write ViewTable**

Write `src/components/analytics/ViewTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { ViewResult } from '@/lib/analytics/types';

interface ViewTableProps {
  result: ViewResult;
  pageSize?: number;
}

export function ViewTable({ result, pageSize = 25 }: ViewTableProps) {
  const rows = result.rows ?? [];
  const [page, setPage] = useState(1);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        No data for this period.
      </div>
    );
  }

  const columns = Object.keys(rows[0]);
  const totalPages = Math.ceil(rows.length / pageSize);
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08]">
              {columns.map((col) => (
                <th key={col} className="px-3 py-2 text-left font-medium text-muted-foreground">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="border-b border-white/[0.04] last:border-0">
                {columns.map((col) => (
                  <td key={col} className="px-3 py-2 text-muted-foreground">
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}</span>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded px-2 py-1 hover:bg-white/5 disabled:opacity-30"
            >
              ‹
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded px-2 py-1 hover:bg-white/5 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  const str = String(value);
  // Truncate ISO timestamps to date for display
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str.slice(0, 10);
  return str;
}
```

- [ ] **Step 4: Verify all compile**

Run: `npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/KpiBanner.tsx src/components/analytics/ViewChart.tsx src/components/analytics/ViewTable.tsx
git commit -m "feat(analytics): add KpiBanner, ViewChart, and ViewTable rendering components"
```

---

# Task 7: PinnedViewCard + ViewListRow components

**Files:**
- Create: `src/components/analytics/PinnedViewCard.tsx`
- Create: `src/components/analytics/ViewListRow.tsx`

- [ ] **Step 1: Write PinnedViewCard**

Write `src/components/analytics/PinnedViewCard.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Pin, Download } from 'lucide-react';
import { ViewChart } from './ViewChart';
import { ViewTable } from './ViewTable';
import { KpiBanner } from './KpiBanner';
import { viewResultToCsvColumns, viewResultToCsvRows } from './export-helpers';
import { exportCsv } from '@/lib/export/csv';
import type { ViewResult } from '@/lib/analytics/types';

interface PinnedViewCardProps {
  result: ViewResult;
  onUnpin: () => void;
}

export function PinnedViewCard({ result, onUnpin }: PinnedViewCardProps) {
  const router = useRouter();
  const { slug, label, chartType } = result.view;

  const handleCsvExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    exportCsv(`vantor-${slug}`, cols, rows);
  };

  return (
    <div
      className="cursor-pointer rounded-xl border border-white/[0.08] bg-card p-4 transition-colors hover:border-white/[0.15]"
      onClick={() => router.push(`/analytics/${slug}`)}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onUnpin(); }}
            className="text-teal-400 hover:text-teal-300"
            title="Unpin"
          >
            <Pin className="h-3.5 w-3.5" fill="currentColor" />
          </button>
          <button
            onClick={handleCsvExport}
            className="text-muted-foreground/60 hover:text-muted-foreground"
            title="Export CSV"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {chartType === 'kpi' && <KpiBanner result={result} />}
      {(chartType === 'line' || chartType === 'bar') && <ViewChart result={result} height={160} />}
      {chartType === 'table' && <ViewTable result={result} pageSize={5} />}
    </div>
  );
}
```

- [ ] **Step 2: Write ViewListRow**

Write `src/components/analytics/ViewListRow.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { Pin, GitFork, Pencil, Download, ChevronRight } from 'lucide-react';
import { exportCsv } from '@/lib/export/csv';
import { viewResultToCsvColumns, viewResultToCsvRows } from './export-helpers';
import { useViewQuery } from '@/hooks/useViewQuery';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';

interface ViewListRowProps {
  view: AnalyticsViewListItem;
  from: string;
  to: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onFork: () => void;
  onEdit?: () => void;
}

const CHART_BADGES: Record<string, string> = {
  kpi: 'KPI',
  line: 'Line',
  bar: 'Bar',
  table: 'Table',
  donut: 'Donut',
};

export function ViewListRow({ view, from, to, isPinned, onTogglePin, onFork, onEdit }: ViewListRowProps) {
  const router = useRouter();

  // Lazy query for CSV export — only triggered on export click
  const { data: result, refetch } = useViewQuery({
    viewSlug: view.slug,
    from,
    to,
    enabled: false,
  });

  const handleCsvExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { data } = await refetch();
    if (data) {
      const cols = viewResultToCsvColumns(data);
      const rows = viewResultToCsvRows(data);
      exportCsv(`vantor-${view.slug}`, cols, rows);
    }
  };

  const isCustom = view.kind === 'custom';

  return (
    <div
      className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:border-white/[0.15] ${
        isCustom ? 'border-amber-500/20 bg-card' : 'border-white/[0.08] bg-card'
      }`}
      onClick={() => router.push(`/analytics/${view.slug}`)}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">{view.label}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {CHART_BADGES[view.chartType] ?? view.chartType}
        </span>
        {isCustom && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
            custom
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`rounded p-1 hover:bg-white/5 ${isPinned ? 'text-teal-400' : 'text-muted-foreground/40'}`}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <Pin className="h-3.5 w-3.5" fill={isPinned ? 'currentColor' : 'none'} />
        </button>
        {isCustom && onEdit ? (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="rounded p-1 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onFork(); }}
            className="rounded p-1 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground"
            title="Fork"
          >
            <GitFork className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={handleCsvExport}
          className="rounded p-1 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground"
          title="CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/PinnedViewCard.tsx src/components/analytics/ViewListRow.tsx
git commit -m "feat(analytics): add PinnedViewCard and ViewListRow components"
```

---

# Task 8: ForkViewModal component

**Files:**
- Create: `src/components/analytics/ForkViewModal.tsx`

- [ ] **Step 1: Write ForkViewModal**

Write `src/components/analytics/ForkViewModal.tsx`:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ViewChart } from './ViewChart';
import { ViewTable } from './ViewTable';
import { KpiBanner } from './KpiBanner';
import { useViewQuery } from '@/hooks/useViewQuery';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';
import type { TimeGranularity } from '@/lib/analytics/types';

interface ForkViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceView: AnalyticsViewListItem | null;
  from: string;
  to: string;
}

const CHART_OPTIONS = ['kpi', 'line', 'bar', 'table'] as const;
const GRANULARITY_OPTIONS: TimeGranularity[] = ['day', 'week', 'month'];

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ForkViewModal({ open, onOpenChange, sourceView, from, to }: ForkViewModalProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState('');
  const [chartType, setChartType] = useState<string>('bar');
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when source changes
  const resetFromSource = useCallback((src: AnalyticsViewListItem | null) => {
    if (!src) return;
    setLabel('');
    setChartType(src.chartType);
    const config = src.config as Record<string, unknown>;
    setGranularity((config.granularity as TimeGranularity) ?? 'day');
    setFilters({});
    setError(null);
  }, []);

  // Reset on open
  if (open && sourceView && !label && chartType !== sourceView.chartType) {
    resetFromSource(sourceView);
  }

  const slug = slugify(label);
  const hasTimeDimension = sourceView?.config
    ? (sourceView.config as Record<string, unknown>).primaryDimension === 'time'
    : false;

  // Live preview
  const preview = useViewQuery({
    viewSlug: sourceView?.slug ?? '',
    from,
    to,
    granularity: hasTimeDimension ? granularity : undefined,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    enabled: open && !!sourceView,
  });

  const handleSubmit = async () => {
    if (!sourceView || !label.trim()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const sourceConfig = sourceView.config as Record<string, unknown>;
      const res = await fetch('/api/analytics/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          slug,
          chartType,
          description: `Custom view forked from ${sourceView.label}`,
          forkedFrom: sourceView.id,
          config: {
            ...sourceConfig,
            granularity: hasTimeDimension ? granularity : undefined,
            defaultFilters: Object.keys(filters).length > 0 ? filters : undefined,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Create failed' }));
        setError(body.error ?? 'Failed to create view');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['analytics-views'] });
      onOpenChange(false);
      router.push(`/analytics/${slug}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sourceView) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fork View</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-xs text-muted-foreground">
            Source: {sourceView.label} ({sourceView.kind})
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Weekly USDC Coverage"
              className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {slug && (
              <div className="mt-1 text-xs text-muted-foreground/60">Slug: {slug}</div>
            )}
          </div>

          {/* Chart type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Chart type</label>
            <div className="flex gap-2">
              {CHART_OPTIONS.map((ct) => (
                <button
                  key={ct}
                  onClick={() => setChartType(ct)}
                  className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${
                    chartType === ct
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.15]'
                  }`}
                >
                  {ct}
                </button>
              ))}
            </div>
          </div>

          {/* Granularity (only for time-dimension views) */}
          {hasTimeDimension && (
            <div>
              <label className="mb-1 block text-sm font-medium">Granularity</label>
              <div className="flex gap-2">
                {GRANULARITY_OPTIONS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${
                      granularity === g
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.15]'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {preview.data && (
            <div>
              <label className="mb-1 block text-sm font-medium">Preview</label>
              <div className="rounded-lg border border-white/[0.06] bg-background p-3">
                {preview.data.view.chartType === 'kpi' && <KpiBanner result={preview.data} />}
                {(preview.data.view.chartType === 'line' || preview.data.view.chartType === 'bar') && (
                  <ViewChart result={preview.data} height={140} />
                )}
                {preview.data.view.chartType === 'table' && (
                  <ViewTable result={preview.data} pageSize={3} />
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-muted-foreground hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!label.trim() || isSubmitting}
            className="btn-gradient rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create View'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/ForkViewModal.tsx
git commit -m "feat(analytics): add ForkViewModal with live preview"
```

---

# Task 9: Analytics list page (`/analytics`)

**Files:**
- Create: `src/app/(app)/analytics/page.tsx`
- Create: `src/components/analytics/AnalyticsPageClient.tsx`

- [ ] **Step 1: Write the page shell**

Write `src/app/(app)/analytics/page.tsx`:

```tsx
import { AnalyticsPageClient } from '@/components/analytics/AnalyticsPageClient';

export default function AnalyticsPage() {
  return <AnalyticsPageClient />;
}
```

- [ ] **Step 2: Write the client component**

Write `src/components/analytics/AnalyticsPageClient.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { FileDown } from 'lucide-react';
import { useAnalyticsViews } from '@/hooks/useAnalyticsViews';
import { useAnalyticsPins } from '@/hooks/useAnalyticsPins';
import { useViewQuery } from '@/hooks/useViewQuery';
import { KpiBanner } from './KpiBanner';
import { PinnedViewCard } from './PinnedViewCard';
import { ViewListRow } from './ViewListRow';
import { ForkViewModal } from './ForkViewModal';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function AnalyticsPageClient() {
  const { from: defaultFrom, to: defaultTo } = useMemo(defaultDateRange, []);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data: views, isLoading: viewsLoading } = useAnalyticsViews();
  const { pins, togglePin, isPinned } = useAnalyticsPins();

  const [forkSource, setForkSource] = useState<AnalyticsViewListItem | null>(null);
  const [forkOpen, setForkOpen] = useState(false);

  // Treasury Summary — always shown
  const summaryQuery = useViewQuery({ viewSlug: 'treasury-summary', from, to });

  // Pinned view queries
  const pinnedQuery1 = useViewQuery({ viewSlug: pins[0] ?? '', from, to, enabled: !!pins[0] });
  const pinnedQuery2 = useViewQuery({ viewSlug: pins[1] ?? '', from, to, enabled: !!pins[1] });
  const pinnedQuery3 = useViewQuery({ viewSlug: pins[2] ?? '', from, to, enabled: !!pins[2] });
  const pinnedQuery4 = useViewQuery({ viewSlug: pins[3] ?? '', from, to, enabled: !!pins[3] });
  const pinnedQueries = [pinnedQuery1, pinnedQuery2, pinnedQuery3, pinnedQuery4];

  const standardViews = (views ?? []).filter((v) => v.kind === 'standard' && v.slug !== 'treasury-summary');
  const customViews = (views ?? []).filter((v) => v.kind === 'custom');

  // Exclude pinned views from the all-views list (they're shown above)
  const unpinnedStandard = standardViews.filter((v) => !isPinned(v.slug));
  const unpinnedCustom = customViews.filter((v) => !isPinned(v.slug));

  const handleFork = (view: AnalyticsViewListItem) => {
    setForkSource(view);
    setForkOpen(true);
  };

  const handleGenerateReport = async () => {
    // Download page-level PDF of pinned views
    const res = await fetch('/api/analytics/export/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vantor-analytics-report-${from}-to-${to}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (viewsLoading) {
    return (
      <div className="p-4 sm:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-white/5" />
          <div className="h-24 rounded-xl bg-white/5" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-40 rounded-xl bg-white/5" />
            <div className="h-40 rounded-xl bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            {standardViews.length + 1} standard views{customViews.length > 0 ? ` + ${customViews.length} custom` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-1.5">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="bg-transparent text-xs text-muted-foreground outline-none"
            />
            <span className="text-xs text-muted-foreground/40">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="bg-transparent text-xs text-muted-foreground outline-none"
            />
          </div>
          <button
            onClick={() => { setForkSource(standardViews[0] ?? null); setForkOpen(true); }}
            className="btn-gradient rounded-lg px-3 py-1.5 text-xs font-medium"
          >
            + New View
          </button>
          <button
            onClick={handleGenerateReport}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
          >
            <FileDown className="h-3.5 w-3.5" />
            Generate Report
          </button>
        </div>
      </div>

      {/* KPI Banner — always pinned */}
      {summaryQuery.data && (
        <div className="mb-4">
          <KpiBanner result={summaryQuery.data} />
        </div>
      )}

      {/* Pinned views */}
      {pins.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {pins.map((slug, i) => {
            const query = pinnedQueries[i];
            if (!query?.data) return null;
            return (
              <PinnedViewCard
                key={slug}
                result={query.data}
                onUnpin={() => togglePin(slug)}
              />
            );
          })}
        </div>
      )}

      {/* All Views */}
      <div>
        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          All Views
        </div>
        <div className="space-y-2">
          {unpinnedStandard.map((view) => (
            <ViewListRow
              key={view.slug}
              view={view}
              from={from}
              to={to}
              isPinned={false}
              onTogglePin={() => togglePin(view.slug)}
              onFork={() => handleFork(view)}
            />
          ))}
        </div>

        {customViews.length > 0 && (
          <>
            <div className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              My Custom Views
            </div>
            <div className="space-y-2">
              {unpinnedCustom.map((view) => (
                <ViewListRow
                  key={view.slug}
                  view={view}
                  from={from}
                  to={to}
                  isPinned={false}
                  onTogglePin={() => togglePin(view.slug)}
                  onFork={() => handleFork(view)}
                  onEdit={() => handleFork(view)} // Edit uses the same modal pattern
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Fork modal */}
      <ForkViewModal
        open={forkOpen}
        onOpenChange={setForkOpen}
        sourceView={forkSource}
        from={from}
        to={to}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/analytics/page.tsx src/components/analytics/AnalyticsPageClient.tsx
git commit -m "feat(analytics): add Analytics list page with pinned views and browse list"
```

---

# Task 10: Drill-in page (`/analytics/[slug]`)

**Files:**
- Create: `src/app/(app)/analytics/[slug]/page.tsx`
- Create: `src/components/analytics/AnalyticsDrillIn.tsx`

- [ ] **Step 1: Write the page shell**

Write `src/app/(app)/analytics/[slug]/page.tsx`:

```tsx
import { AnalyticsDrillIn } from '@/components/analytics/AnalyticsDrillIn';

export default function AnalyticsDrillInPage() {
  return <AnalyticsDrillIn />;
}
```

- [ ] **Step 2: Write the drill-in client component**

Write `src/components/analytics/AnalyticsDrillIn.tsx`:

```tsx
'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, GitFork, Download, FileText } from 'lucide-react';
import { useViewQuery } from '@/hooks/useViewQuery';
import { useAnalyticsViews, type AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';
import { KpiBanner } from './KpiBanner';
import { ViewChart } from './ViewChart';
import { ViewTable } from './ViewTable';
import { ForkViewModal } from './ForkViewModal';
import { viewResultToCsvColumns, viewResultToCsvRows } from './export-helpers';
import { exportCsv } from '@/lib/export/csv';
import { exportPdf } from '@/lib/export/pdf';
import type { TimeGranularity } from '@/lib/analytics/types';

const GRANULARITY_OPTIONS: TimeGranularity[] = ['day', 'week', 'month'];

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function AnalyticsDrillIn() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const { from: defaultFrom, to: defaultTo } = useMemo(defaultDateRange, []);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [forkOpen, setForkOpen] = useState(false);

  const { data: views } = useAnalyticsViews();
  const viewDef = (views ?? []).find((v) => v.slug === slug) ?? null;

  const hasTimeDimension = viewDef?.config
    ? (viewDef.config as Record<string, unknown>).primaryDimension === 'time'
    : false;

  const { data: result, isLoading, isError } = useViewQuery({
    viewSlug: slug,
    from,
    to,
    granularity: hasTimeDimension ? granularity : undefined,
  });

  const handleCsvExport = () => {
    if (!result) return;
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    exportCsv(`vantor-${slug}`, cols, rows);
  };

  const handlePdfExport = () => {
    if (!result) return;
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    exportPdf(`vantor-${slug}`, result.view.label, cols, rows);
  };

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/analytics')}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold">{viewDef?.label ?? slug}</h1>
            {viewDef?.description && (
              <p className="text-sm text-muted-foreground">{viewDef.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setForkOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
          >
            <GitFork className="h-3.5 w-3.5" />
            Fork
          </button>
          <button
            onClick={handleCsvExport}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            onClick={handlePdfExport}
            className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/5"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-transparent text-xs text-muted-foreground outline-none"
          />
          <span className="text-xs text-muted-foreground/40">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-transparent text-xs text-muted-foreground outline-none"
          />
        </div>
        {hasTimeDimension && (
          <div className="flex gap-1">
            {GRANULARITY_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded-lg border px-2.5 py-1 text-xs capitalize transition-colors ${
                  granularity === g
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.15]'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        {viewDef && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${
            viewDef.kind === 'custom' ? 'bg-amber-500/10 text-amber-400' : 'bg-white/5 text-muted-foreground'
          }`}>
            {viewDef.kind}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="animate-pulse rounded-xl bg-white/5 py-32" />
      )}
      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center text-sm text-red-400">
          Failed to load view data. Try adjusting the date range.
        </div>
      )}
      {result && (
        <div className="rounded-xl border border-white/[0.08] bg-card p-4 sm:p-6">
          {result.view.chartType === 'kpi' && <KpiBanner result={result} />}
          {(result.view.chartType === 'line' || result.view.chartType === 'bar') && (
            <ViewChart result={result} height={400} />
          )}
          {result.view.chartType === 'table' && <ViewTable result={result} />}
        </div>
      )}

      {/* Fork modal */}
      <ForkViewModal
        open={forkOpen}
        onOpenChange={setForkOpen}
        sourceView={viewDef}
        from={from}
        to={to}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/app/(app)/analytics/[slug]/page.tsx src/components/analytics/AnalyticsDrillIn.tsx
git commit -m "feat(analytics): add drill-in page at /analytics/[slug]"
```

---

# Task 11: Page-level report export API

**Files:**
- Create: `src/app/api/analytics/export/report/route.ts`

- [ ] **Step 1: Write the export endpoint**

Write `src/app/api/analytics/export/report/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { executeView } from '@/lib/analytics/engine';
import { viewResultToCsvColumns, viewResultToCsvRows } from '@/components/analytics/export-helpers';

const DEFAULT_PINS = ['balance-history', 'obligation-coverage'];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) {
    return NextResponse.json({ error: 'No enterprise' }, { status: 400 });
  }

  let body: { from?: string; to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { from, to } = body;
  if (!from || !to) {
    return NextResponse.json({ error: 'from and to required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Get user's pinned slugs
  const { data: pinData } = await supabase
    .from('analytics_pin_preferences')
    .select('pinned_slugs')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .limit(1);

  const pinnedSlugs = pinData?.[0]?.pinned_slugs ?? DEFAULT_PINS;
  const allSlugs = ['treasury-summary', ...pinnedSlugs];

  // Fetch all pinned views
  const results = await Promise.all(
    allSlugs.map(async (slug) => {
      try {
        return await executeView(supabase, enterpriseId, slug, { from, to });
      } catch {
        return null;
      }
    }),
  );

  // Build multi-section CSV (simpler than server-side PDF — PDF requires @react-pdf which is client-only)
  // Return as CSV with section headers
  const sections: string[] = [];
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  sections.push(`# Vantor Analytics Report — ${from} to ${to}`);
  sections.push(`# Generated: ${now}`);
  sections.push('');

  for (const result of results) {
    if (!result) continue;
    sections.push(`# ${result.view.label}`);
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    if (cols.length > 0 && rows.length > 0) {
      sections.push(cols.map((c) => c.header).join(','));
      for (const row of rows) {
        sections.push(cols.map((c) => c.accessor(row as Record<string, unknown>)).join(','));
      }
    }
    sections.push('');
  }

  const csv = sections.join('\n');
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vantor-analytics-report-${from}-to-${to}.csv"`,
    },
  });
}
```

**Note:** Server-side PDF generation with `@react-pdf/renderer` requires a React DOM environment which isn't available in API routes. The page-level export returns a multi-section CSV instead. Client-side PDF export (per-view) still works via the browser-side `exportPdf()`. If server-side PDF is needed later, a headless rendering approach can be added in Phase C-2.

- [ ] **Step 2: Verify compile**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/analytics/export/report/route.ts
git commit -m "feat(analytics): add page-level pinned-views CSV export endpoint"
```

---

# Task 12: Sidebar nav update

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Read the sidebar file**

Read `src/components/layout/Sidebar.tsx` to find the Records nav group.

- [ ] **Step 2: Add Analytics to the Records group**

Find the Records nav group (the one with Compliance, Invoices, Transactions, Audit, Reporting) and add Analytics as the first item:

```typescript
// In the Records group items array, add before or after Reporting:
{ label: 'Analytics', href: '/analytics', icon: BarChart3 },
```

Also add the import at the top of the file:

```typescript
import { BarChart3 } from 'lucide-react';
```

Make sure `BarChart3` is not already imported — if it is, just reuse it.

- [ ] **Step 3: Verify compile**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat(analytics): add Analytics to sidebar nav under Records"
```

---

# Task 13: Full suite green

- [ ] **Step 1: Run tsc**

Run: `NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit`

Fix any type errors. Common issues:
- Import paths for new analytics components
- ViewResult type narrowing in rendering components
- ExportColumn generic type matching

- [ ] **Step 2: Run vitest**

Run: `npx vitest run`

Expected: all existing tests + new export-helpers tests pass.

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix(analytics): resolve type errors for Phase C-1"
```

---

# Task 14: Architecture doc update

**Files:**
- Modify: `docs/architecture/forecast-analytics.md`

- [ ] **Step 1: Add Phase C-1 section**

Append after the Phase B section in `docs/architecture/forecast-analytics.md`:

```markdown
## Phase C-1 — Custom Views + Export

Phase C-1 adds the Analytics page, custom view forking, and export.

### Analytics page (`/analytics`)

Pinned + browse hybrid layout:
- Treasury Summary KPI banner (always shown)
- Up to 4 user-pinned views rendered inline as mini charts
- Compact list of all standard + custom views with quick actions
- Pin preferences stored in `analytics_pin_preferences` table

### Drill-in (`/analytics/[slug]`)

Full-page view with date range, granularity controls, and export
buttons. Charts rendered via Recharts, tables via ViewTable component.

### Custom views (fork flow)

Users fork any standard or custom view via a modal. Customizable:
filters, chart type, and granularity. Measures locked to source view's
set. Custom views stored in `analytics_views` with `kind='custom'` and
`forked_from` FK.

### Export

- Per-view CSV/PDF: client-side via `exportCsv()` / `exportPdf()`
- Page-level: server-side CSV of all pinned views via
  `POST /api/analytics/export/report`

### Database changes (migration 0048)

- `analytics_pin_preferences` table (user + enterprise scoped)
- `forked_from UUID` column on `analytics_views`
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/forecast-analytics.md
git commit -m "docs(analytics): add Phase C-1 architecture section"
```

---

# Task 15: Final verification + PR

- [ ] **Step 1: Merge master into feature branch**

```bash
cd /c/Users/John/crypto-treasury
git fetch origin master
cd .worktrees/analytics-custom-views
git merge origin/master
```

Resolve any conflicts.

- [ ] **Step 2: Run full verification**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsc --noEmit
npx vitest run
```

All must pass.

- [ ] **Step 3: Apply migration 0048 to prod Supabase**

Swap `.env.local` to prod URL, run:

```bash
export $(grep -v '^#' .env.local | xargs) 2>/dev/null
npx tsx scripts/migrate.ts supabase/migrations/0048_analytics_pins_and_fork.sql
```

Swap back to dev URL.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feature/analytics-custom-views
```

Open PR against `master` with title: `feat: Phase C-1 — Analytics page, custom views, export`

Body:
```
## Summary
- New Analytics page at /analytics with pinned+browse hybrid layout
- Treasury Summary KPI banner always visible, up to 4 pinned view cards
- Full-page drill-in at /analytics/[slug] with date range, granularity, filters
- Fork modal: create custom views from standard templates (filters + display options)
- Per-view CSV/PDF export + page-level pinned-views CSV report
- Migration 0048: analytics_pin_preferences table + forked_from column
- 3 new React Query hooks, 11 new components, 5 new API endpoints

## Test plan
- [x] `npx vitest run` — all tests pass (export-helpers + existing analytics tests)
- [x] `npx tsc --noEmit` — 0 type errors
- [ ] Navigate to /analytics — page renders with KPI banner and pinned views
- [ ] Click a view row — drills into /analytics/[slug] with full chart
- [ ] Fork a standard view — modal opens, preview works, creates custom view
- [ ] Pin/unpin views — persists across page reload
- [ ] CSV export — downloads correct data for each chart type
- [ ] "Generate Report" — downloads multi-section CSV of pinned views
- [ ] Migration 0048 applied to both dev and prod Supabase
```
