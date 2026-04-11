// src/lib/policy/hard-limit-checker/limits/obligation-coverage.ts

import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { computeForecastQueryHash } from '../../ir-evaluator/leaves/forecast-query';
import { ForecastQueryNode } from '../../types/ir';

/**
 * obligation_coverage_days: enforces that all projected obligations within
 * a window (limit.limit_value days) are covered by projected inflows.
 *
 * Reads from pre-loaded context.forecast.results, looking up the entry by
 * a deterministic hash of a synthetic ForecastQueryNode constructed from
 * the limit. The context loader (Plan 2 task) must populate the same hash
 * key when it walks the policy version's hard limits.
 */
export function checkObligationCoverage(
  limit: HardLimit,
  _movement: ProposedMovement,
  ctx: EvaluationContext,
): HardLimitEvaluation {
  const base = {
    limit_id: limit.id,
    limit_type: limit.limit_type,
    limit_name: limit.name,
    limit_value: limit.limit_value,
    limit_currency: limit.limit_currency,
    scope: limit.scope,
  };

  // Parse window_days from limit_value (it's a decimal string)
  const windowDaysNum = Number(limit.limit_value);
  if (!Number.isFinite(windowDaysNum) || !Number.isInteger(windowDaysNum) || windowDaysNum <= 0) {
    return {
      ...base,
      current_value: 'unknown',
      post_transfer_value: 'unknown',
      breached: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Hard limit '${limit.name}' has invalid limit_value: "${limit.limit_value}". obligation_coverage_days requires a positive integer.`,
        details: { limit_value_raw: limit.limit_value },
        user_action: 'Edit the limit in Settings → Policies and set days to a positive integer.',
      },
    };
  }

  // Build a synthetic ForecastQueryNode and hash it the same way the
  // forecast_query leaf does. The context loader must build the same node
  // shape when populating context.forecast.results.
  const syntheticNode: ForecastQueryNode = {
    kind: 'forecast_query',
    query: 'obligations_covered',
    window_days: windowDaysNum,
    comparator: '==',
    value: { amount: '1', currency: 'USD' },
  };
  const hash = computeForecastQueryHash(syntheticNode);
  const result = ctx.forecast.results[hash];

  if (!result) {
    return {
      ...base,
      current_value: 'unknown',
      post_transfer_value: 'unknown',
      breached: false,
      failure: {
        reason_code: 'forecast_unavailable',
        human_readable: `Cannot evaluate '${limit.name}' — obligation coverage forecast for ${windowDaysNum}d window was not pre-loaded.`,
        details: { window_days: windowDaysNum, hash },
        user_action: 'Retry. If the forecast module is in stub mode, this limit is advisory only.',
      },
    };
  }

  if (result.failure) {
    return {
      ...base,
      current_value: 'unknown',
      post_transfer_value: 'unknown',
      breached: false,
      failure: {
        reason_code: result.failure.reason_code,
        human_readable: result.failure.human_readable,
        details: result.failure.details,
        user_action: 'Retry once the forecast service is available.',
      },
    };
  }

  // Validate payload shape (snake_case per Task 11 normalization)
  const v = result.value as
    | { covered?: unknown; obligations_checked?: unknown; obligations_uncovered?: unknown; shortfall_amount?: unknown }
    | null
    | undefined;
  if (v == null || typeof v !== 'object' || typeof v.covered !== 'boolean') {
    return {
      ...base,
      current_value: 'unknown',
      post_transfer_value: 'unknown',
      breached: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Cannot evaluate '${limit.name}' — forecast result payload is malformed (expected ObligationCoverageResult with boolean 'covered').`,
        details: { hash, payload_type: typeof v },
        user_action: 'Forecast service returned an unexpected payload. Contact support.',
      },
    };
  }

  const breached = !v.covered;

  return {
    ...base,
    current_value: v.covered ? 'covered' : 'not_covered',
    post_transfer_value: v.covered ? 'covered' : 'not_covered',
    breached,
    overage: breached ? JSON.stringify(v.shortfall_amount ?? 'unknown') : undefined,
  };
}
