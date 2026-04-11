// src/lib/policy/ir-evaluator/leaves/aggregate-window.ts

import Big from 'big.js';
import { AggregateWindowNode, NumericOp } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';
import { computeWindowSpecHash } from '../../aggregate-detector/hash';

/**
 * Evaluate an aggregate_window leaf against pre-loaded aggregate results
 * in the EvaluationContext.
 *
 * Fail-closed semantics:
 * - missing result → aggregate_query_failed (the context loader should
 *   have populated it; if not, the rule cannot be evaluated and the
 *   transfer should be blocked)
 * - result has failure field → propagate as leaf failure
 * - between operator → structured failure (aggregate_window doesn't
 *   carry value_upper)
 * - big.js throws on malformed numeric values → caught and surfaced as
 *   structured failure
 */
export function evalAggregateWindow(
  node: AggregateWindowNode,
  ctx: EvaluationContext,
): LeafResult {
  const hash = computeWindowSpecHash(node.window);
  const result = ctx.aggregates.user_specs[hash];

  if (!result) {
    return {
      matched: false,
      failure: {
        reason_code: 'aggregate_query_failed',
        human_readable:
          `Aggregate window query for ${describeWindow(node.window)} was not pre-loaded. ` +
          `The context loader may have failed to enumerate this rule's aggregate requirements.`,
        details: { window: node.window, hash },
        user_action: 'Retry evaluation. If the issue persists, contact support with the trace ID.',
      },
      evaluation_details: { hash, window: node.window },
    };
  }

  if (result.failure) {
    return {
      matched: false,
      failure: {
        reason_code: result.failure.reason_code,
        human_readable: result.failure.human_readable,
        details: result.failure.details,
        user_action: 'Retry. If the issue persists, contact support.',
      },
      evaluation_details: { hash, window: node.window },
    };
  }

  // Reject `between` upfront — aggregate_window doesn't carry value_upper
  if (node.op === 'between') {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `aggregate_window does not support the 'between' operator (no value_upper field).`,
        details: { window: node.window, op: node.op, attr: node.attr },
        user_action: 'Edit the rule to use a single-bound operator (>, >=, <, <=, ==, !=).',
      },
      evaluation_details: { hash, window: node.window, attr: node.attr },
    };
  }

  // Extract the value from the aggregate result based on attr
  let actualValue: string;
  switch (node.attr) {
    case 'sum_amount':
      actualValue = result.sum_amount_usd;
      break;
    case 'count':
      actualValue = String(result.count);
      break;
    case 'distinct_destinations':
      actualValue = String(result.distinct_destinations);
      break;
    case 'distinct_counterparties':
      actualValue = String(result.distinct_counterparties);
      break;
    default:
      return assertNeverAttr(node.attr);
  }

  // Empty actualValue is a structured failure, NOT a silent no-match.
  // The aggregate loader returning '' (without setting result.failure)
  // indicates a partial-load bug; treating it as "rule did not fire"
  // would silently approve transfers that depend on this aggregate.
  if (actualValue === '') {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `aggregate_window value for attr=${node.attr} is an empty string. The aggregate loader returned a partial result without setting a failure flag.`,
        details: { attr: node.attr, hash, window: node.window },
        user_action: 'This indicates an aggregate loader bug. Contact support with the trace ID.',
      },
      evaluation_details: { hash, window: node.window, attr: node.attr },
    };
  }

  // Wrap big.js comparison so a malformed sum doesn't escape the leaf
  let matched: boolean;
  try {
    matched = applyNumericOp(actualValue, node.op, node.value.amount);
  } catch (err) {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `aggregate_window value "${actualValue}" for attr=${node.attr} is malformed: ${err instanceof Error ? err.message : String(err)}`,
        details: {
          attr: node.attr,
          actual_value: actualValue,
          threshold: node.value.amount,
        },
        user_action: 'Aggregate detector returned a non-decimal value. Contact support — this indicates upstream data corruption.',
      },
      evaluation_details: { hash, window: node.window, attr: node.attr },
    };
  }

  return {
    matched,
    evaluation_details: {
      hash,
      window: node.window,
      attr: node.attr,
      actual_value: actualValue,
      threshold: node.value.amount,
      op: node.op,
    },
  };
}

function applyNumericOp(left: string, op: NumericOp, right: string): boolean {
  if (!left || !right) return false;
  const L = new Big(left);
  const R = new Big(right);
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
    case 'between':
      return false; // unreachable — caller rejects between upfront
    default:
      return assertNeverOp(op);
  }
}

function describeWindow(window: AggregateWindowNode['window']): string {
  const hours = Math.round(window.duration_ms / 3_600_000);
  const groups = Object.entries(window.group_by)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join('+');
  return `${hours}h by ${groups || 'global'}`;
}

function assertNeverAttr(x: never): never {
  throw new Error(`Unhandled AggregateAttr: ${String(x)}`);
}

function assertNeverOp(x: never): never {
  throw new Error(`Unhandled NumericOp in aggregate-window: ${String(x)}`);
}
