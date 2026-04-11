// src/lib/policy/hard-limit-checker/checker.ts

import {
  HardLimit,
  HardLimitEvaluation,
  HardLimitBreach,
  HardLimitCheckResult,
} from '../types/hard-limit';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { checkMinCashReserve } from './limits/min-cash-reserve';
import { checkMaxConcentration } from './limits/max-concentration';
import { checkMaxOutflow } from './limits/max-outflow';
import { checkObligationCoverage } from './limits/obligation-coverage';
import { checkMaxNativeExposure } from './limits/max-native-exposure';
import { renderBreach } from './templates';

/**
 * HardLimitChecker iterates every hard limit in the policy version,
 * dispatches to the type-specific evaluator, and collects breaches with
 * rendered human-readable messages.
 *
 * Always evaluates ALL limits even past a breach so traces and
 * utilization gauges have complete data. No short-circuit.
 *
 * DOWNSTREAM CONTRACT: the caller (verdict composer) must treat BOTH
 * `result.breaches.length > 0` AND `result.evaluated.some(e => e.failure)`
 * as block conditions. Failures (e.g., canonicalization unavailable) are
 * left on `evaluated[].failure` and are NOT automatically promoted to
 * breaches — the caller decides how to surface them.
 */
export class HardLimitChecker {
  check(movement: ProposedMovement, ctx: EvaluationContext): HardLimitCheckResult {
    const limits = ctx.policy_version.hard_limits;
    const evaluated: HardLimitEvaluation[] = [];
    const breaches: HardLimitBreach[] = [];

    for (const limit of limits) {
      const evaluation = this.evaluateOne(limit, movement, ctx);
      evaluated.push(evaluation);

      // Only promote to HardLimitBreach when the limit was fully evaluated
      // AND breached. Contract invariant (tested in each limit evaluator):
      // breached=true && failure=undefined means a real breach.
      // breached=false || failure=truthy means NOT a breach row — but the
      // caller must still check the failure field to block correctly.
      if (evaluation.breached && !evaluation.failure) {
        const rendered = renderBreach(evaluation);
        breaches.push({
          ...evaluation,
          breached: true,
          overage: evaluation.overage ?? '0',
          reason_code: 'hard_limit_breached',
          human_readable: rendered.human_readable,
          user_action: rendered.user_action,
        });
      }
    }

    return {
      any_breached: breaches.length > 0,
      breaches,
      evaluated,
    };
  }

  private evaluateOne(
    limit: HardLimit,
    movement: ProposedMovement,
    ctx: EvaluationContext,
  ): HardLimitEvaluation {
    switch (limit.limit_type) {
      case 'min_cash_reserve_usd':
        return checkMinCashReserve(limit, movement, ctx);
      case 'max_single_asset_concentration_pct':
        return checkMaxConcentration(limit, movement, ctx);
      case 'max_daily_outflow_usd':
      case 'max_30day_outflow_usd':
        return checkMaxOutflow(limit, movement, ctx);
      case 'obligation_coverage_days':
        return checkObligationCoverage(limit, movement, ctx);
      case 'max_native_exposure':
        return checkMaxNativeExposure(limit, movement, ctx);
      default:
        return assertNeverLimitType(limit.limit_type);
    }
  }
}

function assertNeverLimitType(x: never): never {
  throw new Error(`Unhandled HardLimitType in HardLimitChecker: ${String(x)}`);
}
