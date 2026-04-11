// src/lib/policy/ir-evaluator/leaves/amount-compare.ts

import Big from 'big.js';
import { AmountCompareNode, NumericOp } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';
import { EvaluationContext } from '../../types/context';
import { ReasonCode } from '../../errors/reason-codes';

/**
 * Result of evaluating a single leaf node. Leaves produce booleans
 * (matched / not matched) plus optional structured failure if the
 * leaf could not be fully evaluated.
 *
 * CONTRACT: Callers MUST check `failure` before reading `matched`.
 * `matched: false + failure: truthy` means "could not evaluate" and
 * the rule should be treated as cannot-decide (typically: block).
 * `matched: false + failure: undefined` means "rule did not fire" and
 * the transfer is not affected by this rule.
 */
export interface LeafResult {
  matched: boolean;
  via?: 'direct' | 'splitting';
  splitting_note?: string;
  failure?: LeafFailure;
  evaluation_details: Record<string, unknown>;
}

export interface LeafFailure {
  reason_code: ReasonCode;
  human_readable: string;
  details: Record<string, unknown>;
  user_action: string;
}

/**
 * Evaluate an amount_compare node against a proposed movement + context.
 *
 * Handles the AmountAttribute union:
 *   - attr='transfer.amount' + rule currency matches asset -> direct compare
 *   - attr='transfer.amount' + rule currency is USD -> canonicalized compare
 *   - attr='transfer.amount' -> ALSO runs the 24h splitting guard check
 *   - attr='treasury.position' -> reads pre-loaded native position
 *   - attr='treasury.post_position' -> computed post-transfer position
 *   - attr='rolling_sum' -> internal-only attribute; returns structured failure
 *
 * If the comparison cannot be fully evaluated (rate unavailable, aggregate
 * query failed, missing scope), returns `{ matched: false, failure: {...} }`
 * — the rule's caller should treat this as cannot-fully-evaluate and block.
 *
 * CONTRACT: This function MUST NOT throw for runtime-shaped inputs. Malformed
 * decimal strings in the context (e.g. 'garbage' in positions_by_asset) must
 * be absorbed and surface as `matched: false` rather than an uncaught big.js
 * exception. The only throw path is `assertNever` for exhaustiveness, which
 * represents a programmer error (unreachable at runtime with current types).
 */
export function evalAmountCompare(
  node: AmountCompareNode,
  movement: ProposedMovement,
  ctx: EvaluationContext
): LeafResult {
  switch (node.attr) {
    case 'transfer.amount':
      return evalTransferAmount(node, movement, ctx);
    case 'treasury.position':
      return evalTreasuryPosition(node, ctx, false);
    case 'treasury.post_position':
      return evalTreasuryPosition(node, ctx, true, movement);
    case 'rolling_sum':
      return evalRollingSum(node);
    default:
      return assertNever(node.attr);
  }
}

function evalTransferAmount(
  node: AmountCompareNode,
  movement: ProposedMovement,
  ctx: EvaluationContext
): LeafResult {
  // Determine which amount to compare: native or canonical USD
  const ruleCurrency = node.value.currency;
  const transferAsset = movement.amount.asset;

  let actualValue: string;

  if (ruleCurrency === transferAsset) {
    // Direct comparison — no canonicalization needed
    actualValue = movement.amount.amount;
  } else if (ruleCurrency === 'USD') {
    // Canonicalized comparison via pre-loaded canonicalization result
    if (ctx.canonicalization.failure) {
      return {
        matched: false,
        failure: {
          reason_code: ctx.canonicalization.failure.reason_code,
          human_readable: ctx.canonicalization.failure.human_readable,
          details: ctx.canonicalization.failure.details,
          user_action: ctx.canonicalization.failure.user_action,
        },
        evaluation_details: {
          attr: 'transfer.amount',
          rule_currency: 'USD',
          transfer_asset: transferAsset,
        },
      };
    }
    actualValue = ctx.canonicalization.canonical_amount;
  } else {
    // Rule currency is neither 'USD' nor matches transfer asset — cannot evaluate
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable:
          `Rule compares transfer.amount in ${ruleCurrency}, but transfer is in ${transferAsset}. ` +
          `Phase 1 only supports direct comparisons (same asset) or USD-canonicalized comparisons. ` +
          `Author the rule in ${transferAsset} or USD.`,
        details: { rule_currency: ruleCurrency, transfer_asset: transferAsset },
        user_action: `Edit the rule to compare in USD or in ${transferAsset}.`,
      },
      evaluation_details: { attr: 'transfer.amount' },
    };
  }

  // Direct comparison on the chosen actualValue
  const directMatched = applyNumericOp(
    actualValue,
    node.op,
    node.value.amount,
    node.value_upper?.amount
  );

  if (directMatched) {
    return {
      matched: true,
      via: 'direct',
      evaluation_details: {
        attr: 'transfer.amount',
        actual_value: actualValue,
        threshold: node.value.amount,
        op: node.op,
      },
    };
  }

  // ─── System invariant: splitting guard ──────────────────────────────
  // For every transfer.amount comparison, also evaluate against the 24h
  // rolling sum grouped by (initiator, destination). If that matches, the
  // rule is considered matched via splitting.
  //
  // PHASE-1 LIMITATION: splitting guard only applies when the rule's value.currency
  // is 'USD'. The 24h aggregate is stored in USD, so a non-USD rule threshold
  // can't be compared without canonicalizing the threshold itself, which phase 1
  // doesn't do. Author splitting-sensitive rules in USD until phase 2.

  const splittingGuard = ctx.aggregates.system_splitting_guard_24h;
  if (splittingGuard.failure) {
    // Can't check splitting — but this is a rule we couldn't fully evaluate.
    // Fail-closed: return failure.
    return {
      matched: false,
      failure: {
        reason_code: splittingGuard.failure.reason_code,
        human_readable: `Splitting guard could not load: ${splittingGuard.failure.human_readable}`,
        details: splittingGuard.failure.details,
        user_action: 'Retry; if the issue persists, contact support.',
      },
      evaluation_details: { attr: 'transfer.amount', splitting_check: 'failed' },
    };
  }

  // Compute rolling sum including the proposed movement (in USD)
  const proposedCanonical = ctx.canonicalization.canonical_amount;
  if (!proposedCanonical && ruleCurrency === 'USD') {
    // Rule is in USD but we have no canonicalization — cannot splitting-check
    return {
      matched: false,
      evaluation_details: {
        attr: 'transfer.amount',
        splitting_check: 'skipped_no_canonical',
      },
    };
  }

  // Only USD-denominated rules can be splitting-checked against the USD aggregate
  // in phase 1 (see PHASE-1 LIMITATION comment above).
  const thresholdInUsd = ruleCurrency === 'USD' ? node.value.amount : null;

  if (thresholdInUsd) {
    let rollingWithProposed: string;
    try {
      rollingWithProposed = new Big(splittingGuard.sum_amount_usd)
        .plus(proposedCanonical || '0')
        .toString();
    } catch {
      // Malformed numeric data in aggregate sum or canonical amount — fail-closed.
      return {
        matched: false,
        failure: {
          reason_code: 'condition_node_evaluation_failed',
          human_readable:
            'Splitting guard aggregate contained a non-numeric value; could not compute rolling sum.',
          details: {
            sum_amount_usd: splittingGuard.sum_amount_usd,
            proposed_canonical: proposedCanonical,
          },
          user_action: 'Retry; if the issue persists, contact support.',
        },
        evaluation_details: {
          attr: 'transfer.amount',
          splitting_check: 'malformed_aggregate',
        },
      };
    }

    if (
      applyNumericOp(
        rollingWithProposed,
        node.op,
        thresholdInUsd,
        node.value_upper?.amount
      )
    ) {
      return {
        matched: true,
        via: 'splitting',
        splitting_note:
          `24-hour aggregate to this destination by this initiator is ` +
          `$${splittingGuard.sum_amount_usd}; proposed transfer of $${proposedCanonical} ` +
          `would bring the rolling total to $${rollingWithProposed}, which ${node.op} ` +
          `threshold of $${thresholdInUsd}.`,
        evaluation_details: {
          attr: 'transfer.amount',
          rolling_sum_usd: splittingGuard.sum_amount_usd,
          proposed_canonical: proposedCanonical,
          rolling_with_proposed: rollingWithProposed,
          threshold: thresholdInUsd,
        },
      };
    }
  }

  return {
    matched: false,
    via: 'direct',
    evaluation_details: {
      attr: 'transfer.amount',
      actual_value: actualValue,
      threshold: node.value.amount,
      op: node.op,
    },
  };
}

/**
 * PHASE-1 LIMITATION: post-state computation assumes movement.amount is denominated
 * in the asset being checked. For swaps where source.asset !== destination.asset,
 * the inflow side is computed in source-asset units (incorrect) — phase 2 will
 * either reject post_position checks on swap movements or use a separate
 * destination_amount field on ProposedMovement.
 */
function evalTreasuryPosition(
  node: AmountCompareNode,
  ctx: EvaluationContext,
  postState: boolean,
  movement?: ProposedMovement
): LeafResult {
  if (!node.scope?.asset) {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `amount_compare node with attr="${node.attr}" requires scope.asset`,
        details: { attr: node.attr },
        user_action:
          'Add scope.asset to the rule condition specifying which asset to check.',
      },
      evaluation_details: { attr: node.attr },
    };
  }

  const asset = node.scope.asset;
  const currentPosition = ctx.treasury_state.positions_by_asset[asset] ?? '0';

  let positionValue: string;
  if (postState && movement) {
    const isOutflow = movement.source.asset === asset;
    const isInflow = movement.destination.asset === asset;
    try {
      if (isOutflow && !isInflow) {
        positionValue = new Big(currentPosition)
          .minus(movement.amount.amount)
          .toString();
      } else if (isInflow && !isOutflow) {
        positionValue = new Big(currentPosition)
          .plus(movement.amount.amount)
          .toString();
      } else {
        positionValue = currentPosition;
      }
    } catch {
      // Malformed currentPosition or movement amount — fail-closed with a
      // structured failure so the caller can distinguish "did not fire" from
      // "could not evaluate".
      return {
        matched: false,
        failure: {
          reason_code: 'condition_node_evaluation_failed',
          human_readable: `Treasury position for ${asset} is not a valid decimal; cannot compute post-position.`,
          details: {
            asset,
            current_position: currentPosition,
            movement_amount: movement.amount.amount,
          },
          user_action: 'Retry; if the issue persists, contact support.',
        },
        evaluation_details: { attr: node.attr, asset },
      };
    }
  } else {
    positionValue = currentPosition;
  }

  const matched = applyNumericOp(
    positionValue,
    node.op,
    node.value.amount,
    node.value_upper?.amount
  );

  return {
    matched,
    via: 'direct',
    evaluation_details: {
      attr: node.attr,
      asset,
      position_value: positionValue,
      threshold: node.value.amount,
      op: node.op,
    },
  };
}

function evalRollingSum(node: AmountCompareNode): LeafResult {
  // The rolling_sum attr uses a pre-computed aggregate window; the specific
  // window key is expected to be encoded in node.scope or otherwise addressable.
  // For phase 1, this attr is primarily used internally by the evaluator to
  // reference pre-loaded aggregate_window results. We return a failure if no
  // matching aggregate is available.
  return {
    matched: false,
    failure: {
      reason_code: 'condition_node_evaluation_failed',
      human_readable:
        'amount_compare with attr="rolling_sum" is an internal attribute not directly ' +
        'usable in user-authored rules. Use an aggregate_window node instead.',
      details: { attr: 'rolling_sum', node_op: node.op },
      user_action: 'Replace this rule with an aggregate_window node.',
    },
    evaluation_details: { attr: 'rolling_sum' },
  };
}

/**
 * Apply a numeric operator to decimal-string operands using big.js.
 *
 * CONTRACT: Never throws. If `left`, `right`, or `rightUpper` are empty,
 * malformed, or otherwise unparseable as decimal strings, this returns `false`
 * (i.e. "cannot compare -> did not match"). Call sites that need to
 * distinguish "did not match" from "could not evaluate" should detect the
 * failure condition upstream and return a structured `LeafResult.failure`.
 */
function applyNumericOp(
  left: string,
  op: NumericOp,
  right: string,
  rightUpper?: string
): boolean {
  if (left === '' || right === '') return false;

  let L: Big;
  let R: Big;
  try {
    L = new Big(left);
    R = new Big(right);
  } catch {
    // Malformed numeric string (e.g. 'garbage', 'NaN'). Cannot compare.
    return false;
  }

  switch (op) {
    case '>':
      return L.gt(R);
    case '>=':
      return L.gte(R);
    case '<':
      return L.lt(R);
    case '<=':
      return L.lte(R);
    case '==':
      return L.eq(R);
    case '!=':
      return !L.eq(R);
    case 'between': {
      if (rightUpper === undefined || rightUpper === '') return false;
      let Ru: Big;
      try {
        Ru = new Big(rightUpper);
      } catch {
        return false;
      }
      return L.gte(R) && L.lte(Ru);
    }
    default:
      return assertNever(op);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unhandled AmountAttribute or NumericOp: ${String(x)}`);
}
