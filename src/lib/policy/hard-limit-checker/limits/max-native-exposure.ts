// src/lib/policy/hard-limit-checker/limits/max-native-exposure.ts

import Big from 'big.js';
import { HardLimit, HardLimitEvaluation } from '../../types/hard-limit';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { isValidDecimalString } from '../templates';

/**
 * max_native_exposure: enforces a per-asset cap on native-unit exposure.
 *
 * Direction-aware: if the movement's source.asset matches scope.asset,
 * the position decreases by movement.amount; if destination.asset matches,
 * it increases. If neither matches, the limit is not affected by this
 * movement (returns not-breached with current=post).
 *
 * PHASE-1 LIMITATION: for swap movements where source.asset !=
 * destination.asset and we're checking the destination side, the inflow
 * is computed in source-asset units (since movement.amount is in source
 * units). This is wrong for swaps but acceptable in phase 1 since
 * proper swap support requires a destination_amount field on
 * ProposedMovement.
 */
export function checkMaxNativeExposure(
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

  const scopedAsset = limit.scope.asset;
  if (!scopedAsset) {
    return {
      ...base,
      current_value: '0',
      post_transfer_value: '0',
      breached: false,
      failure: {
        reason_code: 'scope_resolution_failed',
        human_readable: `Hard limit '${limit.name}' (max_native_exposure) has no scope.asset.`,
        details: { limit_id: limit.id },
        user_action: 'Edit the limit in Settings → Policies to specify which asset it applies to.',
      },
    };
  }

  if (!isValidDecimalString(limit.limit_value)) {
    return {
      ...base,
      current_value: '0',
      post_transfer_value: '0',
      breached: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Hard limit '${limit.name}' has malformed limit_value: "${limit.limit_value}"`,
        details: { limit_value_raw: limit.limit_value },
        user_action: 'Edit the limit in Settings → Policies.',
      },
    };
  }

  const isOutflow = movement.source.asset === scopedAsset;
  const isInflow = movement.destination.asset === scopedAsset;

  const currentNativeRaw = ctx.treasury_state.positions_by_asset[scopedAsset] ?? '0';
  if (!isValidDecimalString(currentNativeRaw)) {
    return {
      ...base,
      current_value: currentNativeRaw,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'treasury_state_unavailable',
        human_readable: `Cannot evaluate '${limit.name}' — treasury_state.positions_by_asset[${scopedAsset}] is malformed: "${currentNativeRaw}"`,
        details: { position_raw: currentNativeRaw, asset: scopedAsset },
        user_action: 'Treasury state loader returned an invalid position. Contact support.',
      },
    };
  }

  // If neither source nor destination is the scoped asset, the limit doesn't apply
  if (!isOutflow && !isInflow) {
    return {
      ...base,
      current_value: currentNativeRaw,
      post_transfer_value: currentNativeRaw,
      breached: false,
    };
  }

  if (!isValidDecimalString(movement.amount.amount)) {
    return {
      ...base,
      current_value: currentNativeRaw,
      post_transfer_value: '',
      breached: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Cannot evaluate '${limit.name}' — movement.amount.amount is malformed: "${movement.amount.amount}"`,
        details: { amount_raw: movement.amount.amount },
        user_action: 'The proposed movement has an invalid amount. Contact support.',
      },
    };
  }

  const currentNative = new Big(currentNativeRaw);
  const delta = new Big(movement.amount.amount);

  // For an outflow (source matches scope), subtract delta
  // For an inflow (destination matches scope), add delta
  // For a same-asset venue-to-venue transfer (both match), the net is zero
  let postNative: Big;
  if (isOutflow && isInflow) {
    postNative = currentNative; // venue-to-venue, no net change
  } else if (isOutflow) {
    postNative = currentNative.minus(delta);
  } else {
    postNative = currentNative.plus(delta);
  }

  const limitValue = new Big(limit.limit_value);
  const breached = postNative.gt(limitValue);

  return {
    ...base,
    current_value: currentNative.toString(),
    post_transfer_value: postNative.toString(),
    breached,
    headroom: breached ? undefined : limitValue.minus(postNative).toString(),
    overage: breached ? postNative.minus(limitValue).toString() : undefined,
    utilization_pct: limitValue.gt(0)
      ? Math.min(200, postNative.div(limitValue).times(100).toNumber())
      : undefined,
  };
}
