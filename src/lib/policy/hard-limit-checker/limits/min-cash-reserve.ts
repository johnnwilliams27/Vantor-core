// src/lib/policy/hard-limit-checker/limits/min-cash-reserve.ts

import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { isValidDecimalString } from '../templates';

/**
 * min_cash_reserve_usd: enforces a floor on cash_equivalent_usd after the
 * proposed movement is applied.
 *
 * PHASE-1 CONSERVATISM: every movement is treated as a worst-case outflow
 * from the cash pool — i.e., canonical_amount is unconditionally subtracted
 * from cash_equivalent_usd. This is fail-CLOSED (overestimates cash drain),
 * which is the safe direction for a min-floor check. Plan 2 will refine
 * this with a venues-owned registry that distinguishes inflow vs outflow
 * cash movements.
 */
export function checkMinCashReserve(
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

  // Canonicalization must have succeeded for USD-denominated limits
  if (ctx.canonicalization.failure) {
    return {
      ...base,
      current_value: ctx.treasury_state.cash_equivalent_usd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: ctx.canonicalization.failure.reason_code,
        human_readable: `Cannot evaluate '${limit.name}' — ${ctx.canonicalization.failure.human_readable}`,
        details: ctx.canonicalization.failure.details,
        user_action: ctx.canonicalization.failure.user_action,
      },
    };
  }

  // Validate inputs upfront — malformed treasury state must produce a
  // structured failure, not a raw big.js throw, per the never-throws contract
  if (!isValidDecimalString(ctx.treasury_state.cash_equivalent_usd)) {
    return {
      ...base,
      current_value: ctx.treasury_state.cash_equivalent_usd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'treasury_state_unavailable',
        human_readable: `Cannot evaluate '${limit.name}' — treasury_state.cash_equivalent_usd is malformed: "${ctx.treasury_state.cash_equivalent_usd}"`,
        details: { cash_equivalent_usd_raw: ctx.treasury_state.cash_equivalent_usd },
        user_action: 'Treasury state loader returned an invalid value. Contact support — this indicates upstream data corruption.',
      },
    };
  }

  if (!isValidDecimalString(ctx.canonicalization.canonical_amount)) {
    return {
      ...base,
      current_value: ctx.treasury_state.cash_equivalent_usd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'canonicalization_failed',
        human_readable: `Cannot evaluate '${limit.name}' — canonical_amount is malformed: "${ctx.canonicalization.canonical_amount}"`,
        details: { canonical_amount_raw: ctx.canonicalization.canonical_amount },
        user_action: 'Canonicalizer returned a non-decimal amount. Contact support.',
      },
    };
  }

  if (!isValidDecimalString(limit.limit_value)) {
    return {
      ...base,
      current_value: ctx.treasury_state.cash_equivalent_usd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Hard limit '${limit.name}' has malformed limit_value: "${limit.limit_value}"`,
        details: { limit_value_raw: limit.limit_value },
        user_action: 'Edit the limit in Settings → Policies and ensure the value is a positive decimal number.',
      },
    };
  }

  const cashUsd = new Big(ctx.treasury_state.cash_equivalent_usd);
  const canonicalAmount = new Big(ctx.canonicalization.canonical_amount);
  const limitValue = new Big(limit.limit_value);

  // Phase-1 conservative: every movement reduces cash_equivalent_usd
  const postTransferValue = cashUsd.minus(canonicalAmount).toString();
  const post = new Big(postTransferValue);
  const breached = post.lt(limitValue);

  return {
    ...base,
    current_value: ctx.treasury_state.cash_equivalent_usd,
    post_transfer_value: postTransferValue,
    breached,
    headroom: breached ? undefined : post.minus(limitValue).toString(),
    overage: breached ? limitValue.minus(post).toString() : undefined,
    // For a min-floor limit, utilization_pct = (limit / post) * 100 if post > 0,
    // capped at 200. So 100% means "exactly at floor", >100% means "below floor".
    // Undefined when post <= 0 (treasury is fully drained — utilization is meaningless).
    utilization_pct: post.gt(0)
      ? Math.min(200, limitValue.div(post).times(100).toNumber())
      : undefined,
  };
}
