# Forecast Analytics — Phase A

This document describes the cash-flow forecast subsystem introduced
in Phase A of the Forecast Analytics effort. It is the successor to
the legacy `treasury_forecasts` table and `generateCashFlowForecast`
function, both of which have been removed.

The subsystem's job is to answer two operator questions:

1. **"Given our current treasury and known obligations, are we covered
   for the next N days?"** — used by the rules engine, the Treasury AI
   Forecasting tab, and downstream alerting.
2. **"What would happen if we moved X from venue A to venue B?"** —
   hypothetical projections without mutating live state.

## Architecture overview

```
                 obligations
                 (tenant-scoped, recurrence-expanded
                  via tests/obligations/recurrence)
                         │
                         ▼
  bank_accounts ┐
  wallets       ├─► TreasuryStateService ─► treasury_state_snapshots
  yield_positions│    (frozen positions +
  pending_xfers ┘      fx_rates for replay)
                         │
                         ▼
                 ForecastEngine ─► Projection
                 (pure function,    (daily, minBalance,
                  no I/O)            shortfalls, covered?)
                         │
                         ▼
                 ForecastService ─► forecast_snapshots
                 (persist + correlation    (audit trail with
                  id + consumer tag)        hypothetical flag)
                         │
                 ┌───────┴───────┬─────────────────┐
                 ▼               ▼                 ▼
           rules-engine   Treasury AI UI     agent planner
```

The key property is that the engine is pure: no DB, no clock, no FX
fetch. Everything it needs is threaded in as arguments by
`ForecastService`. That means the engine has deterministic unit tests
(`tests/forecast/engine.test.ts` — 8 hand-calculated scenarios) and
downstream consumers can mock it trivially.

## Database tables

Three new tables, introduced in migrations 0042 and 0043. The legacy
`treasury_forecasts` table is dropped in 0044.

### `treasury_state_snapshots` (0042)

Point-in-time aggregate of an enterprise's full treasury — fiat, crypto,
DeFi positions, pending transfers — with fx_rates captured inline. Any
forecast derived from a given snapshot is replayable: re-run the engine
with the same snapshot and the same obligations and you get the same
daily series, even months later when spot FX has moved.

Trigger column distinguishes `'scheduled' | 'on_demand' | 'pre_decision'
| 'pre_action'` so the audit trail can correlate snapshots back to the
event that caused them.

### `forecast_snapshots` (0043)

Scenario-aware cash-flow forecast with a FK back to the
`treasury_state_snapshot` it was projected from. Every forecast
persists:

- Which scenario it used (`base | conservative | stress | custom`)
- The full `scenario_params` JSONB
- The window (`window_days`)
- The list of obligation ids that fed the projection
- The full `projection` JSONB (daily balances, shortfalls, minBalance)
- A `correlation_id` the consumer can link back to whatever decision
  or action was taken on the basis of this forecast
- A `consumer` label (`rules_engine | agent_planner | treasurer_view |
  alert_eval | analytics_view`)
- `is_hypothetical` + `hypothetical_actions` for overlay runs

RLS scoped to `auth_user_enterprise_id()`, cascades off enterprise
deletion, indexed on `(enterprise_id, computed_at DESC)` and
`correlation_id` for post-hoc audit.

### `obligations` (formerly `manual_obligations`, renamed + extended in 0041)

Not a Phase A table per se, but the canonical source of truth for
everything the engine projects. Extended in 0041 with direction,
confidence, recurrence enum, source, counterparty_id, erp_reference,
recurring_parent_id, settlement_tx_ref, and tag/metadata JSONB.

The legacy `amount_usd`, `is_recurring`, `recurrence_days`, `is_active`
columns are kept as NOT NULL deprecated mirrors so legacy routes
(`/api/treasury/obligations/*`) keep compiling through the transition.

## Forecast service contract

From `src/lib/forecast/service.ts`:

```typescript
export interface ForecastService {
  getProjectedMinBalance(
    asset: string,
    venue: string | null,
    windowDays: number,
  ): Promise<{ amount: number; date: string }>;

  getProjectedPosition(
    asset: string,
    venue: string | null,
    atDate: string,
  ): Promise<number>;

  areObligationsCovered(
    windowDays: number,
    confidenceFilter?: ObligationConfidence[],
  ): Promise<{
    covered: boolean;
    shortfallAmount?: number;
    firstShortfallDate?: string;
    shortfallAsset?: string;
  }>;

  getObligationsDueInWindow(windowDays: number): Promise<Obligation[]>;

  getProjection(windowDays: number): Promise<{
    projection: Projection;
    obligations: Obligation[];
  }>;

  hypothetical(proposedTransfers: ProposedTransfer[]): ForecastService;
}
```

Every method routes through a single private `compute(windowDays)`
helper, so hypothetical overlays and scenario params are applied
consistently whether the caller asks for a min balance, a coverage
verdict, or the full daily projection.

## Scenarios

Canonical shapes live in `src/lib/forecast/scenarios.ts`.

| Scenario       | includeExpected | includeEstimated | extraDrawdownPct | fxStrategy     |
| -------------- | --------------- | ---------------- | ---------------- | -------------- |
| `base`         | true            | false            | 0                | `current`      |
| `conservative` | false           | false            | 0                | `current`      |
| `stress`       | false           | false            | 20               | `pessimistic` (500 bps) |
| `custom`       | caller-supplied | caller-supplied  | caller-supplied  | caller-supplied |

`includeExpected` and `includeEstimated` control which obligation
confidence tiers are projected. `extraDrawdownPct` applies a one-time
day-0 haircut to the starting base balance. `fxStrategy` picks between
the snapshot's captured rates (`current`), a pessimistic bps shift
(`pessimistic`), or a caller-supplied fixed map (`fixed`).

### Adding a new scenario

1. Extend the `forecast_scenario` enum in a new migration (do NOT
   modify 0043). Example:

   ```sql
   ALTER TYPE forecast_scenario ADD VALUE IF NOT EXISTS 'blackswan';
   ```

2. Extend the `ForecastScenario` union in `src/lib/forecast/types.ts`
   and add a case in `resolveScenarioParams` in
   `src/lib/forecast/scenarios.ts`.

3. Add a test in `tests/forecast/scenarios.test.ts` asserting the
   shape.

4. If the UI should expose it, add an entry to `SCENARIO_OPTIONS` in
   `src/components/treasury/ForecastingPageClient.tsx`.

## Hypothetical queries

Hypothetical forecasts apply pretend `ProposedTransfer[]` on top of a
real state snapshot **without mutating it**. They're built by calling
`svc.hypothetical([...])` on any existing ForecastService, which
returns a fresh service instance with an in-memory overlay.

**Persistence policy:** hypothetical services hard-force
`persist: false` internally. A hypothetical `areObligationsCovered`
call will never write to `forecast_snapshots` — even if the parent
service was constructed with `persist: true`. This keeps "what if"
exploration free of audit-trail pollution.

If a caller explicitly wants to persist a hypothetical (e.g. an agent
that wants to record its reasoning for later review), it must
construct a fresh `createForecastService` with both `persist: true`
and `hypotheticalTransfers` passed in directly, bypassing the
overlay proxy. The resulting row has `is_hypothetical: true` and
`hypothetical_actions` populated.

**Mutation safety is locked in by tests:** see
`tests/forecast/hypothetical.test.ts`. The two assertions guarantee
(1) calling hypothetical doesn't change the parent's subsequent
answers, and (2) hypothetical calls never persist by default.

## How the rules engine consumes the service

`src/lib/treasury/rules-engine.ts` exposes two adapter functions that
preserve their legacy signatures so six call sites (cron, API routes,
agent tools) don't need to change:

- `buildTreasurySnapshot` — delegates to `TreasuryStateService` and
  maps the result onto the legacy `TreasurySnapshot` shape.
- `collectObligations` — delegates the manual/recurring path to
  `ForecastService.getObligationsDueInWindow`, while keeping the
  invoices query direct (invoices aren't synced into `obligations`
  yet — that's a later phase).

`computeRecommendation` continues to call both of these exactly as
before and doesn't need to know they've been rewritten underneath.

## Recurring obligation materialization

`src/lib/obligations/materialize.ts` is a pure function that walks
every active recurring obligation and writes future instances up to
90 days ahead, each with `recurrence: 'once'` and
`recurring_parent_id` pointing back at the parent.

It's idempotent: the function rebuilds a `(parent_id, due_date)` Set
from existing rows on every call, plus explicitly skips any instance
whose due_date equals the parent's own dueDate. Running it twice in
a row produces zero new rows.

The `/api/cron/materialize-obligations` endpoint wraps the function
for one-enterprise-per-iteration batching and is registered to fire
at 03:00 daily in `scripts/cron-runner.ts`.

## Performance

Target: project 500 obligations over 90 days in under **100 ms**.
Observed on this branch at the time of landing: ~5 ms.

Benchmark lives at `tests/forecast/performance.bench.test.ts`. It's
warn-only — overruns log a console warning but don't fail the suite.
A hard ceiling of 1000 ms is enforced as an assertion so genuine
O(n²) regressions get caught.

## Phase B — Analytics Engine

Phase B adds a measures/dimensions analytics engine with 12 standard
views and rewires the Report Builder to consume it.

### Architecture

```
  MEASURES registry      DIMENSIONS registry
  (26 measures,           (9 dimensions,
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

26 measures defined in `src/lib/analytics/measures.ts`. Each has a
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

### Forecast vs Actuals

The `forecast-vs-actuals` view subsumes the legacy `simulation_runs`
table. It compares the daily projected balance from the most recent
base-scenario forecast snapshot against actual treasury state
snapshots. The simulation_runs table and `runHistoricalSimulation()`
function remain for backwards compatibility but are no longer the
primary tool for forecast validation.

## Phase C roadmap

Phase B deliberately left these for later:

- **Custom view builder** (CRUD on `analytics_views` with `kind='custom'`)
- **Fork standard views into custom**
- **Threshold alerting per view**
- **Scheduled delivery (email/Slack)**
- **CSV/PDF export from any view**

## Phase A leftovers (still open)

- **Invoice sync.** Invoices don't yet flow into the `obligations`
  table via `source='erp_sync'`. Until they do, the rules engine
  queries `invoices` directly in `collectObligations`.
- **Native FX conversion on the legacy rules-engine path.** The
  shape still treats obligation amounts as USD-native. Multi-currency
  obligations route correctly through ForecastService, but the
  legacy `UpcomingObligation.amountUsd` field doesn't FX-convert.
- **Treasury AI UI native consumption.** The Forecasting tab still
  reads the legacy `TreasuryForecast` shape via an adapter. A Phase B
  rewrite will have it consume the raw `Projection` shape directly
  from `forecast_snapshots`, unlocking per-day drill-down and scenario
  comparison views.
- **Agent planner persistence.** `hypothetical()` supports persisting
  but no current consumer turns it on. Phase C agent work will need
  hypothetical forecasts to leave an audit trail via
  `forecast_snapshots.is_hypothetical`.
