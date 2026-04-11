// src/lib/policy/types/context.ts

import { AssetCode, VenueId } from './assets';
import { PolicyVersionSnapshot } from './policy-version';
import { SanctionsStatus } from './ir';

/**
 * Fully-hydrated input to the pure evaluator. Built by the async
 * EvaluationContextLoader in context-loader/loader.ts.
 */
export interface EvaluationContext {
  now: Date;
  enterprise_id: string;
  policy_version: PolicyVersionSnapshot;
  treasury_state: TreasuryState;
  canonicalization: CanonicalizationResult;
  aggregates: AggregateWindowResults;
  sanctions: SanctionsSnapshot;
  forecast: ForecastSnapshot;
  counterparty?: CounterpartyHistoryRecord;
}

/**
 * Point-in-time view of the enterprise's treasury. All USD-equivalent
 * fields are canonicalized at load time.
 */
export interface TreasuryState {
  positions_by_asset: Partial<Record<AssetCode, string>>;     // native amounts
  positions_by_asset_venue: Record<string, string>;           // key: "asset:venue"
  positions_usd_by_asset: Partial<Record<AssetCode, string>>; // USD-equivalent per asset
  total_treasury_usd: string;                                 // sum of all positions_usd
  cash_equivalent_usd: string;                                // sum of USD + stablecoin positions
  loaded_at: Date;
  failures?: TreasuryStateFailure[];                          // partial-load failures
}

export interface TreasuryStateFailure {
  asset?: AssetCode;
  venue?: VenueId;
  reason_code: 'treasury_state_unavailable' | 'scope_resolution_failed';
  human_readable: string;
}

/**
 * Pre-computed canonicalization for the proposed movement. The evaluator
 * reads `canonical_amount_usd` directly rather than calling the rate
 * provider during evaluation — keeps the evaluator pure.
 */
export interface CanonicalizationResult {
  native_amount: string;
  native_asset: AssetCode;
  canonical_amount: string;       // in USD; empty string if canonicalization failed
  canonical_currency: 'USD';
  rate: string;                   // decimal string (e.g., "1.0002")
  rate_source: string;            // e.g., 'coingecko' | 'manual_override'
  rate_as_of: Date;               // when the underlying rate was read
  max_age_ms: number;             // policy engine's staleness threshold
  failure?: CanonicalizationFailure;
}

export interface CanonicalizationFailure {
  reason_code: 'canonicalization_failed' | 'canonicalization_source_unavailable' | 'canonicalization_rate_stale';
  human_readable: string;
  details: Record<string, unknown>;
  user_action: string;
}

/**
 * Pre-loaded aggregate window queries, keyed by a deterministic hash of
 * the window spec. The always-on 24h splitting guard is populated under
 * the `system_splitting_guard_24h` field; user-authored aggregate_window
 * nodes are resolved through `user_specs`.
 */
export interface AggregateWindowResults {
  system_splitting_guard_24h: AggregateWindowResult;
  user_specs: Record<string, AggregateWindowResult>;
}

export interface AggregateWindowResult {
  window_spec_hash: string;
  window_start: Date;
  window_end: Date;
  sum_amount_usd: string;
  sum_amount_by_asset: Partial<Record<AssetCode, string>>;
  count: number;
  distinct_destinations: number;
  distinct_counterparties: number;
  included_evaluation_ids: string[];
  includes_proposed: false;       // always false — evaluator adds proposed at comparison time
  failure?: AggregateWindowFailure;
}

export interface AggregateWindowFailure {
  reason_code: 'aggregate_query_failed' | 'window_spec_invalid';
  human_readable: string;
  details: Record<string, unknown>;
}

/**
 * Sanctions status for the proposed movement's counterparty (if any).
 * Pulled from existing sanctions_screenings table.
 */
export interface SanctionsSnapshot {
  counterparty_id?: string;
  status: SanctionsStatus;
  screened_at?: Date;
  failure?: SanctionsSnapshotFailure;
}

export interface SanctionsSnapshotFailure {
  reason_code: 'sanctions_status_unavailable';
  human_readable: string;
  details: Record<string, unknown>;
}

/**
 * Pre-loaded forecast results. Built by calling the ForecastQuery interface
 * during context load. The stub fills this with permissive defaults.
 */
export interface ForecastSnapshot {
  query_metadata: ForecastQueryMetadata;
  hypothetical_metadata: ForecastQueryMetadata;
  results: Record<string, ForecastQueryResult>;      // keyed by query hash
}

export interface ForecastQueryMetadata {
  mode: 'stub' | 'real';
  snapshot_taken_at: Date;
  source: string;
  freshness_ms?: number;
  warnings: string[];
}

export interface ForecastQueryResult {
  value?: unknown;                // query-kind-specific payload
  failure?: ForecastQueryFailure;
}

export interface ForecastQueryFailure {
  reason_code: 'forecast_unavailable';
  human_readable: string;
  details: Record<string, unknown>;
}

/**
 * Historical context about the proposed movement's counterparty. Used by
 * time_since_last_to_counterparty, rule conditions, and counterparty rules.
 */
export interface CounterpartyHistoryRecord {
  id: string;
  first_seen_at?: Date;
  last_transfer_at?: Date;
  total_volume_usd?: string;
  transfer_count?: number;
  failure?: CounterpartyHistoryFailure;
}

export interface CounterpartyHistoryFailure {
  reason_code: 'counterparty_lookup_failed';
  human_readable: string;
  details: Record<string, unknown>;
}
