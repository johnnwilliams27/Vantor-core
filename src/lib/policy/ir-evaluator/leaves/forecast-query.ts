// src/lib/policy/ir-evaluator/leaves/forecast-query.ts

import Big from 'big.js';
import { createHash } from 'crypto';
import { ForecastQueryNode, NumericOp } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';

/**
 * Deterministic hash of a forecast_query node's shape — used as the
 * key in context.forecast.results. Every rule that references the
 * same query (same kind, same window_days, same scope) shares one
 * pre-loaded result.
 *
 * Scope keys are extracted in a fixed order so that callers building
 * `{ asset, venue }` vs `{ venue, asset }` produce the same hash.
 * Without canonicalization, JSON.stringify would honor insertion order
 * and the loader would populate only one of the two — every rule with
 * the other key order would silently take the forecast_unavailable
 * branch.
 */
export function computeForecastQueryHash(node: ForecastQueryNode): string {
  const canonical = JSON.stringify({
    query: node.query,
    window_days: node.window_days,
    scope: {
      asset: node.scope?.asset ?? null,
      venue: node.scope?.venue ?? null,
    },
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Evaluate a forecast_query leaf against pre-loaded forecast results
 * in the EvaluationContext.
 *
 * Fail-closed semantics:
 * - missing result → forecast_unavailable failure (the context loader
 *   should have populated it; if not, that's a real upstream bug, not
 *   "rule did not fire")
 * - result has failure field → propagate as leaf failure
 * - malformed payload (wrong shape for the query kind) → structured
 *   condition_node_evaluation_failed (rather than silently no-match
 *   via cast)
 * - non-boolean comparator on obligations_covered → structured failure
 *   (a malformed rule, not "rule did not fire")
 * - between operator → structured failure (forecast_query doesn't
 *   support between; the IR schema's NumericOp union includes it but
 *   the comparator field on ForecastQueryNode lacks the value_upper
 *   slot needed)
 * - big.js throws on malformed numeric payload → caught and surfaced
 *   as structured failure
 */
export function evalForecastQuery(node: ForecastQueryNode, ctx: EvaluationContext): LeafResult {
  const hash = computeForecastQueryHash(node);
  const result = ctx.forecast.results[hash];

  if (!result) {
    return {
      matched: false,
      failure: {
        reason_code: 'forecast_unavailable',
        human_readable:
          `Forecast query ${node.query} for window ${node.window_days}d was not pre-loaded into context. ` +
          `Either the context loader failed to enumerate this rule's forecast requirements (a loader bug — ` +
          `contact support with the trace ID), or the forecast module rejected the query upstream (a ` +
          `transient service issue — retry in a few minutes).`,
        details: { query: node.query, window_days: node.window_days, hash },
        user_action:
          'Retry once. If the same query is missing on retry, this is a context-loader bug — contact support with the trace ID rather than continuing to retry.',
      },
      evaluation_details: { query: node.query, hash },
    };
  }

  if (result.failure) {
    return {
      matched: false,
      failure: {
        reason_code: result.failure.reason_code,
        human_readable: result.failure.human_readable,
        details: result.failure.details,
        user_action: 'Retry once the forecast service is available.',
      },
      evaluation_details: { query: node.query, hash },
    };
  }

  // Reject `between` upfront — forecast_query doesn't carry a value_upper
  if (node.comparator === 'between') {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `forecast_query does not support the 'between' comparator (no value_upper field).`,
        details: { query: node.query, comparator: node.comparator },
        user_action: 'Edit the rule to use a single-bound comparator (>, >=, <, <=, ==, !=).',
      },
      evaluation_details: { query: node.query, hash },
    };
  }

  return evaluateAgainstComparator(node, result.value, hash);
}

function evaluateAgainstComparator(
  node: ForecastQueryNode,
  value: unknown,
  hash: string,
): LeafResult {
  switch (node.query) {
    case 'obligations_covered': {
      // Validate payload shape: { covered: boolean, ... }
      if (
        value == null ||
        typeof value !== 'object' ||
        typeof (value as { covered?: unknown }).covered !== 'boolean'
      ) {
        return malformedPayloadFailure(node, hash, value, 'expected { covered: boolean }');
      }
      const covered = (value as { covered: boolean }).covered;

      // Threshold encoding: amount '1' or 'true' → expected true; '0' or 'false' → expected false
      const amt = node.value.amount.toLowerCase();
      let expected: boolean;
      if (amt === '1' || amt === 'true') expected = true;
      else if (amt === '0' || amt === 'false') expected = false;
      else {
        return {
          matched: false,
          failure: {
            reason_code: 'condition_node_evaluation_failed',
            human_readable: `obligations_covered rule has malformed threshold: "${node.value.amount}" — expected '1'/'true' or '0'/'false'.`,
            details: { query: node.query, threshold: node.value.amount },
            user_action: 'Edit the rule threshold to "1" (covered) or "0" (not covered).',
          },
          evaluation_details: { query: node.query, hash },
        };
      }

      let matched: boolean;
      switch (node.comparator) {
        case '==':
          matched = covered === expected;
          break;
        case '!=':
          matched = covered !== expected;
          break;
        default:
          // Non-equality comparators on a boolean coverage result are nonsense
          return {
            matched: false,
            failure: {
              reason_code: 'condition_node_evaluation_failed',
              human_readable: `obligations_covered only supports == and != comparators (got ${node.comparator}).`,
              details: { query: node.query, comparator: node.comparator },
              user_action: 'Edit the rule to use == or !=.',
            },
            evaluation_details: { query: node.query, hash },
          };
      }

      return {
        matched,
        evaluation_details: {
          query: node.query,
          hash,
          payload: { covered },
          op: node.comparator,
          expected,
        },
      };
    }
    case 'projected_min_balance':
    case 'projected_position': {
      // Validate payload shape: { amount: string, asset: string }
      if (
        value == null ||
        typeof value !== 'object' ||
        typeof (value as { amount?: unknown }).amount !== 'string' ||
        typeof (value as { asset?: unknown }).asset !== 'string'
      ) {
        return malformedPayloadFailure(node, hash, value, 'expected { amount: string, asset: string }');
      }

      const amt = (value as { amount: string }).amount;

      // Empty amount string is a structured failure, NOT a silent no-match.
      // The forecast loader returning '' (without setting result.failure)
      // indicates a partial-load bug; treating it as "rule did not fire"
      // would silently approve transfers that depend on this forecast.
      if (amt === '') {
        return {
          matched: false,
          failure: {
            reason_code: 'condition_node_evaluation_failed',
            human_readable: `forecast_query payload for ${node.query} has an empty amount string. The forecast loader returned a partial result without setting a failure flag.`,
            details: { query: node.query, hash },
            user_action: 'This indicates a forecast loader bug. Contact support with the trace ID.',
          },
          evaluation_details: { query: node.query, hash },
        };
      }

      // Wrap big.js comparison so a malformed amount string doesn't throw
      let matched: boolean;
      try {
        matched = applyNumericOp(amt, node.comparator, node.value.amount);
      } catch (err) {
        return {
          matched: false,
          failure: {
            reason_code: 'condition_node_evaluation_failed',
            human_readable: `forecast_query payload contains malformed amount "${amt}" for ${node.query}: ${err instanceof Error ? err.message : String(err)}`,
            details: {
              query: node.query,
              actual_amount: amt,
              threshold: node.value.amount,
            },
            user_action: 'The forecast service returned a non-decimal amount. Contact support — this indicates upstream data corruption.',
          },
          evaluation_details: { query: node.query, hash },
        };
      }

      return {
        matched,
        evaluation_details: {
          query: node.query,
          hash,
          payload: value,
          op: node.comparator,
          threshold: node.value.amount,
        },
      };
    }
    default:
      return assertNeverQuery(node.query);
  }
}

function malformedPayloadFailure(
  node: ForecastQueryNode,
  hash: string,
  value: unknown,
  expectedShape: string,
): LeafResult {
  return {
    matched: false,
    failure: {
      reason_code: 'condition_node_evaluation_failed',
      human_readable: `forecast_query result for ${node.query} has malformed payload: ${expectedShape}, got ${typeof value === 'object' ? JSON.stringify(value) : typeof value}`,
      details: { query: node.query, payload_type: typeof value, expected: expectedShape },
      user_action: 'Forecast service returned an unexpected payload shape. Contact support.',
    },
    evaluation_details: { query: node.query, hash },
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

function assertNeverQuery(x: never): never {
  throw new Error(`Unhandled ForecastQueryKind: ${String(x)}`);
}

function assertNeverOp(x: never): never {
  throw new Error(`Unhandled NumericOp in forecast-query: ${String(x)}`);
}
