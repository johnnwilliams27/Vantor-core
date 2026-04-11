// src/lib/policy/types/hard-limit.ts

import { AssetCode, VenueId } from './assets';
import { ReasonCode } from '../errors/reason-codes';

/**
 * Closed set of hard limit types in phase 1. Expansion requires:
 *   1. New value here (TypeScript catches missed switches everywhere)
 *   2. New CHECK constraint value in policy_hard_limits.limit_type
 *   3. New evaluator function in hard-limit-checker/limits/
 *   4. New template in hard-limit-checker/templates.ts
 *   5. New authoring form field in Plan 3 UI
 */
export type HardLimitType =
  | 'min_cash_reserve_usd'
  | 'max_single_asset_concentration_pct'
  | 'max_daily_outflow_usd'
  | 'max_30day_outflow_usd'
  | 'obligation_coverage_days'
  | 'max_native_exposure';

export interface HardLimitScope {
  asset?: AssetCode;
  venue?: VenueId;
  include_venues?: VenueId[];
}

/**
 * A single hard limit row from policy_hard_limits, hydrated into a
 * PolicyVersionSnapshot and consumed by the checker.
 */
export interface HardLimit {
  id: string;
  limit_type: HardLimitType;
  name: string;
  limit_value: string;           // decimal string
  limit_currency?: AssetCode;    // USD for monetary, NULL for %/duration
  scope: HardLimitScope;
}

/**
 * Result of evaluating a single hard limit against a proposed movement.
 * Contains the pre-transfer state, post-transfer state, and whether the
 * limit was breached — always populated, even when no breach occurred,
 * so the utilization UI can display gauges.
 */
export interface HardLimitEvaluation {
  limit_id: string;
  limit_type: HardLimitType;
  limit_name: string;
  limit_value: string;
  limit_currency?: AssetCode;
  scope: HardLimitScope;
  current_value: string;         // pre-transfer
  post_transfer_value: string;   // post-transfer (what the check uses)
  breached: boolean;
  headroom?: string;             // populated if NOT breached
  overage?: string;              // populated if breached
  utilization_pct?: number;      // (post / limit) * 100, clamped to [0, 200]
  failure?: HardLimitFailure;    // populated if limit could not be evaluated
}

export interface HardLimitBreach extends HardLimitEvaluation {
  breached: true;
  overage: string;
  reason_code: 'hard_limit_breached';
  human_readable: string;
  user_action: string;
}

export interface HardLimitFailure {
  reason_code: ReasonCode;
  human_readable: string;
  details: Record<string, unknown>;
  user_action: string;
}

export interface HardLimitCheckResult {
  any_breached: boolean;
  breaches: HardLimitBreach[];
  evaluated: HardLimitEvaluation[];   // all limits, always
}
