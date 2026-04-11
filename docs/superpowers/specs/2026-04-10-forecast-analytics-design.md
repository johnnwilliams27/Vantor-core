# Cash Forecast & Treasury Analytics — Design Note

**Date:** 2026-04-10
**Branch:** `feature/forecast-analytics`
**Status:** Approved by John 2026-04-10

## 1. Reality check — what already exists

Vantor already has substantial pieces of this. The conflict map:

| Spec calls for | Already exists as | Verdict |
|---|---|---|
| Obligations model | `manual_obligations` (0005) — minimal: label, amount_usd, due_date, is_recurring, recurrence_days, is_active, enterprise_id | **Extend in place + rename** to `obligations` |
| Forecast engine | `predictions.ts > generateCashFlowForecast` — single-scenario, day-by-day, no scenarios, no hypothetical, no snapshots | **Replace** |
| Forecast persistence | `treasury_forecasts` (0006) — JSONB blob upserted per (user_id, lookahead_days) | **Hard cut** — drop table, replace with `forecast_snapshots` |
| Rules engine forecast interface | `rules-engine.ts > collectObligations()` + `buildTreasurySnapshot()` — direct DB calls inline | **Wrap** in new ForecastService |
| Forecast vs actuals | `simulation_runs` (0006) | **Subsume** as one analytics view in Phase B |
| Standard analytics views | Report Builder (`src/components/reporting/`) — 9 fixed PDF/CSV sections | **Reimplement** Report Builder data fetchers as adapters over the analytics engine in Phase B |
| Yield analytics | `yield_positions`, `yield_transactions`, `yield_rate_cache` | **Read-only** |
| FX handling | `fx_rate_cache` + `oracle.ts` + `lib/fx/live-rates.ts` | **Use as-is, single source** |
| Treasury state snapshot | None — computed inline by `buildTreasurySnapshot()` | **Build new, persist for history** |
| Measures/dimensions registry | None | **Build new (Phase B)** |
| Custom view builder | None | **Build new (Phase C)** |
| Threshold alerting | None | **Build new (Phase C)** |

## 2. Phasing

- **Phase A** (this plan) — Obligations v2, Treasury State Snapshot, Forecast Engine, Forecast Service contract. Hard-cuts the legacy `treasury_forecasts` table.
- **Phase B** — Measures/dimensions registry, analytics query engine, 12 standard views as seeded DB rows, Report Builder reimplementation as adapter.
- **Phase C** — Custom view builder, alerting, scheduled delivery, exports.

Each phase ships independently and is independently testable.

## 3. Schemas (approved)

### 3.1 Obligations — `manual_obligations` → `obligations`

New enums: `obligation_type`, `obligation_confidence`, `obligation_source`, `obligation_status`, `obligation_recurrence`.

New columns added in place: `direction`, `currency`, `asset`, `amount` (native), `source_account_id`, `source_venue_kind`, `confidence`, `source`, `status`, `recurrence`, `recurrence_cron`, `counterparty_id`, `erp_reference`, `recurring_parent_id`, `tags`, `metadata`, `paid_at`, `settlement_tx_ref`.

Legacy `is_recurring` / `recurrence_days` / `amount_usd` columns kept and marked DEPRECATED for one release. Backfilled from `recurrence_days` → `recurrence` enum.

Recurring obligations: parent template + materialized future instances 90 days out via nightly job. Editing parent only affects un-materialized instances; past materialized rows immutable.

A payroll obligation in EUR paid from a USDC wallet stores `{currency: 'EUR', asset: 'USDC', amount: 50000}`. The forecast does the FX leg via `fx_rate_cache` at projection time using the active scenario's `fx_strategy`.

### 3.2 Treasury state snapshot — `treasury_state_snapshots`

Aggregates from `bank_accounts`, `wallet_balances`, `yield_positions`, plus pending rows from `transfers` / `bridge_transfers` / `fiat_payments` / `fiat_transactions` / `yield_transactions`. Persists for history. Captures FX rates inline for reproducibility. No new data entry path — pure aggregation.

### 3.3 Forecast snapshot — `forecast_snapshots`

Persisted per decision-relevant computation. Carries `correlation_id` linking to the consuming `ai_recommendations.id` or `transfers.id`. Hypotheticals NOT persisted by default — only when caller passes `persist=true`.

### 3.4 Forecast service contract

```typescript
interface ForecastService {
  getProjectedMinBalance(asset, venue, windowDays): Promise<{amount, date}>;
  getProjectedPosition(asset, venue, atDate): Promise<number>;
  areObligationsCovered(windowDays, confidenceFilter?): Promise<{covered, shortfallAmount?, firstShortfallDate?, shortfallAsset?}>;
  getObligationsDueInWindow(windowDays): Promise<Obligation[]>;
  hypothetical(proposedTransfers): ForecastService;
}
```

`hypothetical()` returns a new instance with in-memory overlay — no DB writes, no mutation. Performance target: <100ms for 90d × 500 obligations (warn-only benchmark, not CI gate).

## 4. Resolved questions (from review)

1. **Phasing** — A/B/C split approved.
2. **Manual obligations rename** — in place rename approved.
3. **Currency vs asset** — `currency` (denomination) + `asset` (settled in) + `amount` (native). FX at projection time.
4. **`treasury_forecasts` cutover** — hard cut. Drop the table in Phase A; update all UI callers in the same plan.
5. **Report Builder** — reimplement data fetchers as adapters over analytics engine in Phase B. PDF/composition stays in `src/components/reporting/`.
6. **"Treasurer" role** — `treasury_manager` OR `enterprise_admin` for analytics CRUD. Phase C will gate `analytics_views` and `analytics_alerts` writes on these roles.
7. **Standard views storage** — seeded DB rows under `analytics_views` with `kind='standard'`. Treasurers can fork into custom views.
8. **Idle cash definition** — balance minus (sum of confirmed outflows in next N days, where N = active treasury rule's `obligation_lookahead_days`).
9. **Performance target** — warn-only benchmark, <100ms target. No CI gate.
10. **Worktree** — `.worktrees/forecast-analytics` on `feature/forecast-analytics`. Created.

## 5. Out of scope for Phase A

- Measures registry, analytics engine, standard views (Phase B)
- Custom view builder, alerting, scheduled delivery, exports (Phase C)
- ERP integration for obligation sourcing (future workstream — schema is designed to slot it in)
- Frontend chart rendering (frontend consumes structured data from the API)
