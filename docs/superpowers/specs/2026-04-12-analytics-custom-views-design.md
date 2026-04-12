# Analytics Custom Views + Export — Design Note

**Date:** 2026-04-12
**Branch:** TBD (Phase C-1 feature branch)
**Status:** Draft — pending review
**Depends on:** Phase B analytics engine (shipped 2026-04-12)

## 1. What this builds

A dedicated Analytics page at `/analytics` where treasury managers can browse the 12 standard views, pin favorites for at-a-glance monitoring, fork views into customized versions, drill into full-page detail, and export data (per-view CSV/PDF or page-level pinned-views PDF).

Phase C-1 does NOT include: blank-canvas view builder, measure editing, threshold alerting, scheduled delivery, or replacement of the existing Report Builder at `/reporting`.

## 2. Decisions (approved during brainstorming)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Where does the view builder live? | Dedicated `/analytics` page under Records in sidebar | Keeps Report Builder focused on PDF composition; Analytics focused on exploration |
| 2 | Custom view creation model | Template-first — fork from standard/custom, customize from there | Most approachable for treasury managers; no blank canvas |
| 3 | What can users customize? | Filters + display (chart type, granularity, sort) | Covers 90% of use cases without becoming a full builder |
| 4 | Per-view vs page-level export | Both — per-view CSV/PDF buttons + page-level "Generate Report" for pinned views | Quick grabs + board-ready reports |
| 5 | Page-level export flow | One-click: exports all pinned views as single branded PDF | Existing Report Builder handles full composition; keep Analytics export simple |
| 6 | Analytics page layout | Pinned + Browse Hybrid (Option C) | Matches Modern Treasury, Trovata, Kyriba patterns; elevates key metrics while keeping everything browsable |
| 7 | Drill-in experience | Full page at `/analytics/[slug]` | Charts and tables need breathing room; slide-over too cramped for data-heavy views |

## 3. Page structure

### 3.1 Analytics list page (`/analytics`)

```
┌─────────────────────────────────────────────────────────┐
│ Analytics                    [Last 30d ▾] [+ New] [PDF] │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Treasury Summary (KPI banner, always pinned)        │ │
│ │ $2.4M total  $1.2M fiat  $800K stable  $320K idle  │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌──────────────────────┐ ┌──────────────────────┐       ���
│ │ Balance History       │ │ Forecast vs Actuals  │       │
│ │ [line chart]    📌CSV │ │ [line chart]   📌CSV │       │
│ └──────────────────────┘ └──────────────────────┘       │
│                                                         │
│ ALL VIEWS                                               │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Obligation Coverage    bar    standard  [fork] [CSV]│ │
│ │ Ramp Activity          bar    standard  [fork] [CSV]│ │
│ │ Transfer Volume        table  standard  [fork] [CSV]│ │
│ │ Swap Activity          table  standard  [fork] [CSV]│ │
│ │ Invoice Aging          bar    standard  [fork] [CSV]│ │
│ │ AI Actions             table  standard  [fork] [CSV]│ │
│ │ Compliance Summary     kpi    standard  [fork] [CSV]│ │
│ │ Yield Performance      table  standard  [fork] [CSV]│ │
│ │ Idle Cash Trend        line   standard  [fork] [CSV]│ │
│ │ ─── My Custom Views ───                             │ │
│ │ Weekly USDC Coverage   bar    custom    [edit] [CSV]│ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Header controls:**
- Global date range picker (applies to all views on the page)
- "+ New View" button — opens the fork modal with the 12 standard views as templates
- "Generate Report" button — exports all pinned views as a single branded PDF

**Pinned section:**
- Treasury Summary KPI banner is always pinned (cannot be unpinned)
- Users can pin up to 4 additional views (chart/table rendered inline)
- Pin/unpin via a pin icon on each view card or list row
- Pinned views show a mini chart/table preview with per-view CSV export button

**All Views list:**
- Standard views listed first, grouped logically (Treasury, Activity, Detail)
- Custom views in a separate "My Custom Views" section with distinct accent (amber border)
- Each row shows: slug, chart type badge, kind badge (standard/custom), quick actions
- Quick actions: fork (standard) or edit (custom), CSV export, drill-in chevron
- Click anywhere on the row to drill into full-page view

**Pin persistence:** Pinned view slugs stored in `analytics_views` as a user preference, or in a new `user_analytics_preferences` row. Simplest: store as a JSONB column on the user's profile or a dedicated small table.

### 3.2 Drill-in page (`/analytics/[slug]`)

```
┌─────────────────────────────────────────────────────────┐
│ ← Back to Analytics    Balance History     [Fork] [CSV] │
├─────────────────────────────────────────────────────────┤
│ [date range]  [granularity: day|week|month]  [filters]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│              [full-width chart or table]                 │
│                                                         │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ View info: "Daily balance trend across fiat, stablecoin, │
│ and DeFi positions" — standard view                     │
└─────────────────────────────────────────────────────────┘
```

**Header:** Back link, view label, Fork button, CSV/PDF export buttons.

**Controls bar:** Date range picker, granularity toggle (day/week/month for time-dimension views), filter dropdowns (status, direction, chain, etc. — only the dimensions the view supports).

**Content area:** Full-width rendering of the view:
- KPI views: large stat cards
- Line/bar views: Recharts chart filling the width
- Table views: full-width data table with FilterBar + TablePagination (using existing shared components)

**Footer:** View description + kind badge. For custom views, also show "forked from [parent]" link.

### 3.3 Fork modal

Triggered by "Fork" on drill-in page or "+ New View" on list page.

```
┌─────────────────────────────────────────────────────┐
│ Fork View                                     [X]   │
├─────────────────────────────────────────────────────┤
│ Source: Obligation Coverage (standard)               │
│                                                     │
│ Name:  [Weekly USDC Coverage_____________]          │
│                                                     │
│ Chart type:  ● Bar  ○ Line  ○ Table  ○ KPI         │
│ Granularity: ○ Day  ● Week  ○ Month                 │
│                                                     │
│ Default filters:                                    │
│  Direction:  [All ▾]                                │
│  Status:     [All ▾]                                │
│  Confidence: [Confirmed ▾]                          │
│                                                     │
│ Preview:                                            │
│ ┌─────────────────────────────────────────────┐     │
│ │         [live preview of the forked view]    │     │
│ └─────────────────────────────────────────────┘     │
│                                                     │
│                        [Cancel]  [Create View]      │
└─────────────────────────────────────────────────────┘
```

**Fields:**
- **Name** — required, unique per enterprise (slug auto-generated from name)
- **Chart type** — radio group, pre-selected from source view's type
- **Granularity** — radio group, only shown for time-dimension views
- **Default filters** — dropdowns for each dimension the source view's measures support. Pre-populated from the source view's defaults.
- **Preview** — live preview fetched via `POST /api/analytics/query` with the current fork config. Updates on any field change (debounced 500ms).

**On create:** POST to `/api/analytics/views` with `kind='custom'`, `enterprise_id` set, config from form. Redirect to the new view's drill-in page.

### 3.4 Edit modal (custom views only)

Same as fork modal but pre-populated with the custom view's current config. Additional options:
- **Rename** — update label
- **Delete** — with confirmation dialog ("This cannot be undone")

Standard views cannot be edited — only forked.

## 4. Export

### 4.1 Per-view CSV

Available on every view (list row, pinned card, drill-in page). Calls `POST /api/analytics/query` with the view's config, converts the `ViewResult` rows/series/groups to CSV using the existing `exportCsv()` utility from `src/lib/export/csv.ts`.

**Column mapping by chart type:**
- Table views: columns from row keys (same as existing table export)
- KPI views: single row with measure labels as headers, values as the row
- Line views: date column + one column per series measure
- Bar views: group column + one column per grouped measure

### 4.2 Per-view PDF

Same data as CSV but rendered via `exportPdf()` from `src/lib/export/pdf.tsx`. Uses the existing `TableExportPdf` component. Charts are exported as data tables in PDF (not as rendered chart images — that would require canvas capture which is out of scope).

### 4.3 Page-level "Generate Report"

One-click export of all pinned views into a single branded PDF:
1. Fetch data for each pinned view via the analytics query API
2. Compose into a multi-section PDF using `@react-pdf/renderer`
3. Each pinned view becomes a section with its label as header
4. Treasury Summary KPI banner as the first section
5. Reuse the existing PDF styling from `src/lib/export/pdf.tsx`
6. Download as `vantor-analytics-report-YYYY-MM-DD.pdf`

## 5. Data model changes

### 5.1 Pin preferences

New table `analytics_pin_preferences`:

```sql
CREATE TABLE analytics_pin_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  pinned_slugs  TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, enterprise_id)
);
```

- `pinned_slugs` is an ordered array of view slugs (max 4 user-chosen pins). Treasury Summary is always rendered at the top regardless of this array — it is NOT stored in `pinned_slugs` and does not count toward the 4-pin limit.
- Default for new users: `['balance-history', 'obligation-coverage']`

### 5.2 Custom views

Already supported by the `analytics_views` table from Phase B migration 0047. Custom views have `enterprise_id` set and `kind='custom'`. No schema changes needed.

### 5.3 Fork tracking

Add `forked_from` column to `analytics_views`:

```sql
ALTER TABLE analytics_views
  ADD COLUMN IF NOT EXISTS forked_from UUID REFERENCES analytics_views(id) ON DELETE SET NULL;
```

This links custom views back to their source for the "forked from [parent]" display.

## 6. API changes

### 6.1 New endpoints

**`GET /api/analytics/pins`** — returns the user's pinned slugs for the current enterprise.

**`PUT /api/analytics/pins`** — updates pinned slugs. Body: `{ slugs: string[] }`. Validates max 4, all slugs must be valid view slugs.

**`POST /api/analytics/views`** (extend existing) — create a custom view. Body: `{ label, slug, chartType, config, forkedFrom? }`. Sets `enterprise_id` from session, `kind='custom'`.

**`POST /api/analytics/export/report`** — generates the page-level PDF. Body: `{ from, to }`. Fetches pinned views, composes PDF, returns as blob.

### 6.2 Existing endpoints (no changes needed)

- `POST /api/analytics/query` — already handles any view slug
- `GET /api/analytics/views` — extend to return custom views alongside standard views
- `GET/PATCH/DELETE /api/analytics/views/[id]` — already supports custom view CRUD

## 7. Frontend components

### 7.1 New pages

- `src/app/(app)/analytics/page.tsx` — Analytics list page (server component shell)
- `src/app/(app)/analytics/[slug]/page.tsx` — Drill-in page (server component shell)
- `src/components/analytics/AnalyticsPageClient.tsx` — client component for list page
- `src/components/analytics/AnalyticsDrillIn.tsx` — client component for drill-in
- `src/components/analytics/PinnedViewCard.tsx` — renders a pinned view with mini chart
- `src/components/analytics/ViewListRow.tsx` — single row in the all-views list
- `src/components/analytics/ForkViewModal.tsx` — fork/create modal with preview
- `src/components/analytics/EditViewModal.tsx` — edit modal for custom views
- `src/components/analytics/KpiBanner.tsx` — Treasury Summary KPI display
- `src/components/analytics/ViewChart.tsx` — renders a Recharts chart from ViewResult
- `src/components/analytics/ViewTable.tsx` — renders a data table from ViewResult rows

### 7.2 New hooks

- `src/hooks/useAnalyticsViews.ts` — fetches standard + custom views
- `src/hooks/useAnalyticsPins.ts` — fetches/updates pin preferences
- `src/hooks/useViewQuery.ts` — wraps `POST /api/analytics/query` in React Query

### 7.3 Shared components reused

- `src/components/ui/tab-nav.tsx` — not needed (single page, no tabs)
- `src/components/ui/filter-bar.tsx` — used on drill-in page for view filters
- `src/components/ui/table-pagination.tsx` — used on drill-in page for table views
- `src/lib/export/csv.ts` — per-view CSV export
- `src/lib/export/pdf.tsx` — per-view + page-level PDF export

### 7.4 Sidebar update

Add "Analytics" entry to the sidebar nav under Records, between Reporting and Compliance (or adjacent to Reporting). Icon: `BarChart3` from lucide-react.

## 8. Visual design

**Follows existing Vantor dark-mode theme:**
- Background: dark (`#0f1219` / `bg-background`)
- Cards: `rounded-xl` with `dark:border-white/[0.08]`
- Primary accent: teal `hsl(182, 58%, 28%)` for CTAs and chart colors
- Custom view accent: amber border/badge to distinguish from standard
- Pin indicator: small teal dot or filled pin icon
- KPI banner: full-width card with stat columns, matching Dashboard KPI style
- Charts: Recharts with teal primary, amber secondary, consistent with existing yield/forecast charts

**Responsive:**
- Pinned charts stack vertically on mobile (1 column)
- All-views list is full-width on all breakpoints
- Drill-in chart/table is full-width
- Fork modal is full-screen on mobile, centered 480px modal on desktop

## 9. Out of scope

- Blank-canvas view builder (pick arbitrary measures)
- Measure add/remove on fork (locked to source view's measures)
- Threshold alerting per view
- Scheduled delivery (email/Slack)
- Replacing the existing Report Builder at `/reporting`
- Chart image export (canvas capture) — tables only in PDF
- Sharing views across enterprises
- View permissions beyond enterprise scoping

These are all Phase C-2 or later.
