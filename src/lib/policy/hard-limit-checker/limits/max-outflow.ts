// src/lib/policy/hard-limit-checker/limits/max-outflow.ts

import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { isValidDecimalString } from '../templates';

/**
 * max_daily_outflow_usd / max_30day_outflow_usd: enforces a cap on the
 * trailing-window outflow total (rolling sum + proposed transfer).
 *
 * For max_daily_outflow_usd, reads from system_splitting_guard_24h
 * (which the context loader always populates).
 *
 * For max_30day_outflow_usd, iterates user_specs looking for an
 * aggregate window with duration ≥ 30 days. PHASE-1 KLUDGE: proper
 * lookup-by-hash requires the limit to carry a WindowSpec, which it
 * doesn't yet. Plan 2 will either thread a WindowSpec through HardLimit
 * or have the context loader pre-key 30-day aggregates by limit_type.
 */
export function checkMaxOutflow(
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

  // Resolve trailing sum based on limit type
  let trailingSumUsd: string;
  if (limit.limit_type === 'max_daily_outflow_usd') {
    if (ctx.aggregates.system_splitting_guard_24h.failure) {
      return {
        ...base,
        current_value: '0',
        post_transfer_value: '',
        breached: false,
        failure: {
          reason_code: ctx.aggregates.system_splitting_guard_24h.failure.reason_code,
          human_readable: `Cannot evaluate '${limit.name}' — splitting guard aggregate failed: ${ctx.aggregates.system_splitting_guard_24h.failure.human_readable}`,
          details: ctx.aggregates.system_splitting_guard_24h.failure.details,
          user_action: 'Retry. If the issue persists, contact support.',
        },
      };
    }
    trailingSumUsd = ctx.aggregates.system_splitting_guard_24h.sum_amount_usd;
  } else {
    // 30-day lookup — iterate user_specs for an entry with sufficient duration.
    //
    // PHASE-1 CONTRACT: the context loader (Plan 2) MUST populate EXACTLY
    // ONE ungrouped 30d aggregate in user_specs when a max_30day_outflow_usd
    // hard limit exists. If multiple entries match the ≥30d duration check,
    // this code silently picks the first one, which may underestimate the
    // true trailing sum and produce a false-negative breach.
    //
    // Plan 2 refinement options: (a) key user_specs by limit_id for hard
    // limits, (b) thread a WindowSpec through HardLimit so this code can
    // compute the hash directly, (c) move 30d aggregates to a separate
    // system-level field analogous to system_splitting_guard_24h.
    const thirtyDayMs = 30 * 86_400_000;
    const tolerance = 60_000; // 1 minute
    const thirtyDay = Object.values(ctx.aggregates.user_specs).find(
      (r) => r.window_end.getTime() - r.window_start.getTime() >= thirtyDayMs - tolerance,
    );
    if (!thirtyDay) {
      return {
        ...base,
        current_value: '0',
        post_transfer_value: '',
        breached: false,
        failure: {
          reason_code: 'historical_outflow_unavailable',
          human_readable: `Cannot evaluate '${limit.name}' — 30-day trailing outflow data was not pre-loaded into context. The context loader did not enumerate this limit.`,
          details: { limit_type: limit.limit_type, user_specs_count: Object.keys(ctx.aggregates.user_specs).length },
          user_action: 'Retry. If the issue persists, contact support — this indicates a context loader bug.',
        },
      };
    }
    if (thirtyDay.failure) {
      return {
        ...base,
        current_value: '0',
        post_transfer_value: '',
        breached: false,
        failure: {
          reason_code: thirtyDay.failure.reason_code,
          human_readable: `Cannot evaluate '${limit.name}' — 30-day aggregate failed: ${thirtyDay.failure.human_readable}`,
          details: thirtyDay.failure.details,
          user_action: 'Retry. If the issue persists, contact support.',
        },
      };
    }
    trailingSumUsd = thirtyDay.sum_amount_usd;
  }

  if (ctx.canonicalization.failure) {
    return {
      ...base,
      current_value: trailingSumUsd,
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

  // Validate decimal inputs upfront
  if (!isValidDecimalString(trailingSumUsd)) {
    return {
      ...base,
      current_value: trailingSumUsd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'historical_outflow_unavailable',
        human_readable: `Cannot evaluate '${limit.name}' — trailing aggregate sum is malformed: "${trailingSumUsd}"`,
        details: { sum_amount_usd_raw: trailingSumUsd },
        user_action: 'Aggregate detector returned an invalid sum. Contact support.',
      },
    };
  }

  if (!isValidDecimalString(ctx.canonicalization.canonical_amount)) {
    return {
      ...base,
      current_value: trailingSumUsd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'canonicalization_failed',
        human_readable: `Cannot evaluate '${limit.name}' — canonical_amount is malformed.`,
        details: { canonical_amount_raw: ctx.canonicalization.canonical_amount },
        user_action: 'Canonicalizer returned a non-decimal amount. Contact support.',
      },
    };
  }

  if (!isValidDecimalString(limit.limit_value)) {
    return {
      ...base,
      current_value: trailingSumUsd,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Hard limit '${limit.name}' has malformed limit_value: "${limit.limit_value}"`,
        details: { limit_value_raw: limit.limit_value },
        user_action: 'Edit the limit in Settings → Policies.',
      },
    };
  }

  const trailing = new Big(trailingSumUsd);
  const proposed = new Big(ctx.canonicalization.canonical_amount);
  const postTransferValue = trailing.plus(proposed).toString();
  const post = new Big(postTransferValue);
  const limitValue = new Big(limit.limit_value);
  const breached = post.gt(limitValue);

  return {
    ...base,
    current_value: trailingSumUsd,
    post_transfer_value: postTransferValue,
    breached,
    headroom: breached ? undefined : limitValue.minus(post).toString(),
    overage: breached ? post.minus(limitValue).toString() : undefined,
    utilization_pct: limitValue.gt(0)
      ? Math.min(200, post.div(limitValue).times(100).toNumber())
      : undefined,
  };
}
