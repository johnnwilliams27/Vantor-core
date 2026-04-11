// src/lib/policy/hard-limit-checker/limits/max-concentration.ts

import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { isValidDecimalString } from '../templates';

/**
 * max_single_asset_concentration_pct: enforces a cap on the maximum
 * percentage any single asset can represent of the total treasury.
 *
 * PHASE-1 CONSERVATISM: the proposed movement is treated as an outflow
 * from movement.source.asset (canonical_amount subtracted from that
 * position, plus from total_treasury_usd). This is the worst-case
 * direction for a max-percentage check on a non-source asset (since
 * shrinking the denominator inflates other assets' percentages). Plan 2
 * will distinguish inflow vs outflow with a venues-owned registry.
 */
export function checkMaxConcentration(
  limit: HardLimit,
  movement: ProposedMovement,
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

  if (ctx.canonicalization.failure) {
    return {
      ...base,
      current_value: '0',
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

  if (!isValidDecimalString(ctx.treasury_state.total_treasury_usd)) {
    return {
      ...base,
      current_value: '0',
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'treasury_state_unavailable',
        human_readable: `Cannot evaluate '${limit.name}' — treasury_state.total_treasury_usd is malformed.`,
        details: { total_treasury_usd_raw: ctx.treasury_state.total_treasury_usd },
        user_action: 'Treasury state loader returned an invalid total. Contact support.',
      },
    };
  }

  if (!isValidDecimalString(limit.limit_value)) {
    return {
      ...base,
      current_value: '0',
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

  const total = new Big(ctx.treasury_state.total_treasury_usd);
  const canonicalAmount = new Big(ctx.canonicalization.canonical_amount || '0');

  // Compute current max concentration (pre-transfer) — used for the
  // current_value field even when no breach
  let currentMaxPct = new Big(0);
  if (total.gt(0)) {
    for (const [, pos] of Object.entries(ctx.treasury_state.positions_usd_by_asset)) {
      if (!isValidDecimalString(pos)) continue; // skip malformed entries silently for current calc
      const pct = new Big(pos).div(total).times(100);
      if (pct.gt(currentMaxPct)) currentMaxPct = pct;
    }
  }

  // Build post-transfer position map (phase-1: assume outflow from source)
  const postPositions: Record<string, string> = { ...ctx.treasury_state.positions_usd_by_asset };
  const srcAsset = movement.source.asset;
  const srcCurrent = ctx.treasury_state.positions_usd_by_asset[srcAsset];
  if (srcCurrent !== undefined && isValidDecimalString(srcCurrent)) {
    postPositions[srcAsset] = new Big(srcCurrent).minus(canonicalAmount).toString();
  }

  const newTotal = total.minus(canonicalAmount);

  let postMaxPct = new Big(0);
  if (newTotal.gt(0)) {
    for (const [, pos] of Object.entries(postPositions)) {
      if (!isValidDecimalString(pos)) continue;
      const pct = new Big(pos).div(newTotal).times(100);
      if (pct.gt(postMaxPct)) postMaxPct = pct;
    }
  }

  const limitValue = new Big(limit.limit_value);
  const breached = postMaxPct.gt(limitValue);

  return {
    ...base,
    current_value: currentMaxPct.toFixed(2),
    post_transfer_value: postMaxPct.toFixed(2),
    breached,
    headroom: breached ? undefined : limitValue.minus(postMaxPct).toFixed(2),
    overage: breached ? postMaxPct.minus(limitValue).toFixed(2) : undefined,
    utilization_pct: limitValue.gt(0)
      ? Math.min(200, postMaxPct.div(limitValue).times(100).toNumber())
      : undefined,
  };
}
