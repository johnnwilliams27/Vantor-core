// src/lib/policy/ir-evaluator/evaluator.ts

import { Condition } from '../types/ir';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { LeafResult, evalAmountCompare } from './leaves/amount-compare';
import { evalStringCompare } from './leaves/string-compare';
import { evalTimeCompare } from './leaves/time-compare';
import { evalSanctionsStatus } from './leaves/sanctions-status';
import { evalForecastQuery } from './leaves/forecast-query';
import { evalAggregateWindow } from './leaves/aggregate-window';

/**
 * Path through the IR tree, used for trace generation by the rule
 * engine. Currently threaded through but not consumed by leaves —
 * future trace work (Plan 2) will surface this in evaluation_details
 * so a UI can highlight which subtree caused a match or failure.
 */
export type ConditionPath = (string | number)[];

/**
 * Recursively evaluate a Condition IR tree against a proposed movement
 * and context. Returns a LeafResult — composite nodes (and/or/not) also
 * return LeafResult with aggregated matched/failure fields.
 *
 * Failure semantics (cannot-fully-evaluate = block):
 * - AND: if any child returns a failure, AND returns failure (fail-fast).
 *   If any child cleanly returns matched=false (no failure), AND returns
 *   matched=false (no failure).
 * - OR: if any child matches, OR returns matched=true (short-circuit;
 *   sibling failures are ignored — the OR is fully evaluable when one
 *   branch is known true). If no child matches AND at least one child
 *   has a failure, OR returns the first failure. If all children
 *   cleanly returned matched=false, OR returns matched=false.
 * - NOT: failure propagates unchanged from the child; otherwise the
 *   child's matched value is negated.
 *
 * This implements the spec's "cannot-fully-evaluate must never let a
 * transfer pass" invariant while allowing fully-evaluable OR branches
 * to succeed without being blocked by sibling branch failures.
 */
/**
 * Defensive recursion depth guard. The Task 6 zod schema enforces
 * MAX_CONDITION_DEPTH=32 at the API boundary, but any internal caller
 * (migrations, rule-authoring helpers, tests) constructing a Condition
 * without going through the schema could hand the evaluator an
 * arbitrarily deep tree and stack-overflow the process. This guard
 * converts that into a structured failure that surfaces as a block.
 *
 * Set to 64 (2x the schema limit) so well-formed inputs always pass
 * but pathological inputs are caught.
 */
const MAX_EVALUATION_DEPTH = 64;

export function evalCondition(
  cond: Condition,
  movement: ProposedMovement,
  ctx: EvaluationContext,
  path: ConditionPath,
): LeafResult {
  if (path.length > MAX_EVALUATION_DEPTH) {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `Condition tree exceeded maximum evaluation depth (${MAX_EVALUATION_DEPTH}). The IR may be malformed or maliciously constructed.`,
        details: { depth: path.length, max_depth: MAX_EVALUATION_DEPTH, path },
        user_action: 'This indicates a malformed rule or a bug in the rule authoring path. Contact support with the trace ID.',
      },
      evaluation_details: { depth_exceeded: true, path },
    };
  }

  switch (cond.kind) {
    case 'and':
      return evalAnd(cond.children, movement, ctx, path);

    case 'or':
      return evalOr(cond.children, movement, ctx, path);

    case 'not': {
      const childResult = evalCondition(cond.child, movement, ctx, [...path, 'child']);
      if (childResult.failure) {
        return {
          matched: false,
          failure: childResult.failure,
          evaluation_details: { node_kind: 'not', path, child_details: childResult.evaluation_details },
        };
      }
      return {
        matched: !childResult.matched,
        evaluation_details: { node_kind: 'not', path, inner_matched: childResult.matched },
      };
    }

    case 'amount_compare':
      return evalAmountCompare(cond, movement, ctx);

    case 'string_compare':
      return evalStringCompare(cond, movement);

    case 'time_compare':
      return evalTimeCompare(cond, ctx);

    case 'sanctions_status':
      return evalSanctionsStatus(cond, ctx);

    case 'forecast_query':
      return evalForecastQuery(cond, ctx);

    case 'aggregate_window':
      return evalAggregateWindow(cond, ctx);

    default:
      return assertNeverKind(cond);
  }
}

function evalAnd(
  children: Condition[],
  movement: ProposedMovement,
  ctx: EvaluationContext,
  path: ConditionPath,
): LeafResult {
  // Empty AND is vacuously true. The schema should reject empty children
  // arrays at validation time, but this defines the runtime semantics
  // explicitly so a buggy upstream can't cause silent fail-open by
  // returning the wrong value (it would return matched=true here, which
  // is the SAFE direction for an AND of zero conditions — "all of {} are
  // true" by classical logic).
  if (children.length === 0) {
    return {
      matched: true,
      evaluation_details: { node_kind: 'and', path, children_count: 0, vacuous: true },
    };
  }

  for (let i = 0; i < children.length; i++) {
    const result = evalCondition(children[i], movement, ctx, [...path, 'children', i]);
    if (result.failure) {
      return {
        matched: false,
        failure: result.failure,
        evaluation_details: { node_kind: 'and', path, failed_child_index: i },
      };
    }
    if (!result.matched) {
      return {
        matched: false,
        evaluation_details: { node_kind: 'and', path, first_non_matching_child_index: i },
      };
    }
  }
  return {
    matched: true,
    evaluation_details: { node_kind: 'and', path, children_count: children.length },
  };
}

function evalOr(
  children: Condition[],
  movement: ProposedMovement,
  ctx: EvaluationContext,
  path: ConditionPath,
): LeafResult {
  // Empty OR is vacuously false. The schema should reject empty children
  // at validation time. Semantically "any of {} is true" is false by
  // classical logic. This is the SAFE direction (no rule firing) for an
  // empty OR — but the absence of any branches is suspicious enough that
  // the schema should catch it before reaching here.
  if (children.length === 0) {
    return {
      matched: false,
      evaluation_details: { node_kind: 'or', path, children_count: 0, vacuous: true },
    };
  }

  let firstFailure: LeafResult['failure'] | undefined;

  for (let i = 0; i < children.length; i++) {
    const result = evalCondition(children[i], movement, ctx, [...path, 'children', i]);
    if (result.matched) {
      // Any match short-circuits; failures in other branches don't matter
      return {
        matched: true,
        evaluation_details: { node_kind: 'or', path, matching_child_index: i },
      };
    }
    if (result.failure && !firstFailure) {
      firstFailure = result.failure;
    }
  }

  // No match. If any child had a failure, propagate the FIRST one — the
  // OR could not be fully evaluated because at least one branch is unknown
  // (cannot-fully-evaluate = block).
  if (firstFailure) {
    return {
      matched: false,
      failure: firstFailure,
      evaluation_details: { node_kind: 'or', path, children_count: children.length },
    };
  }

  return {
    matched: false,
    evaluation_details: { node_kind: 'or', path, children_count: children.length },
  };
}

function assertNeverKind(x: never): never {
  throw new Error(`Unhandled Condition kind: ${JSON.stringify(x)}`);
}
