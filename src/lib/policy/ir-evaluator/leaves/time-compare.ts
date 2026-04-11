// src/lib/policy/ir-evaluator/leaves/time-compare.ts

import { TimeCompareNode, TimeOp } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';

/**
 * Evaluate a time_compare leaf against the evaluation context's `now`
 * and counterparty history.
 *
 * PHASE-1 LIMITATIONS:
 * - `now.day_of_week` and `now.hour_local` use UTC despite the "_local"
 *   suffix. Per-enterprise timezone is deferred to phase 2 — until then,
 *   business-hours rules are evaluated in UTC. Document in rule UI.
 * - `time_since_last_by_initiator` always returns undefined (the loader
 *   for this attribute is in plan 2). A rule using this attr will return
 *   a structured failure rather than silently matching false.
 * - Negative `time_since_last_to_counterparty` (last_transfer_at in the
 *   future, indicating clock skew or upstream data corruption) returns
 *   a structured failure rather than a confusing negative duration.
 */
export function evalTimeCompare(node: TimeCompareNode, ctx: EvaluationContext): LeafResult {
  const extracted = extractTimeAttr(node.attr, ctx);

  if (extracted.kind === 'failure') {
    return {
      matched: false,
      failure: extracted.failure,
      evaluation_details: { attr: node.attr },
    };
  }

  if (extracted.kind === 'absent') {
    return {
      matched: false,
      evaluation_details: { attr: node.attr, actual_value: null },
    };
  }

  const actualValue = extracted.value;

  // Validate op vs operand type BEFORE calling applyTimeOp so the structured
  // failure is the source of truth, not a fallback override.
  if (typeof actualValue === 'boolean' && node.op !== '==' && node.op !== '!=') {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `time_compare attr="${node.attr}" returns a boolean; only ==/!= operators are valid (got ${node.op}).`,
        details: { attr: node.attr, op: node.op },
        user_action: 'Edit the rule to use == or != with this attribute.',
      },
      evaluation_details: { attr: node.attr },
    };
  }

  // For numeric operands, validate the rule's RHS shape so a malformed rule
  // (e.g., null/boolean/'' coerced to 0 via Number()) cannot silently match.
  if (typeof actualValue === 'number') {
    const rhsValidation = validateNumericRhs(node.op, node.value);
    if (!rhsValidation.ok) {
      return {
        matched: false,
        failure: {
          reason_code: 'condition_node_evaluation_failed',
          human_readable: `time_compare attr="${node.attr}" op="${node.op}" has malformed value: ${rhsValidation.reason}`,
          details: { attr: node.attr, op: node.op, value: node.value, value_type: typeof node.value },
          user_action: 'Edit the rule to provide a numeric value (or numeric array for in/not_in).',
        },
        evaluation_details: { attr: node.attr },
      };
    }
  }

  const matched = applyTimeOp(actualValue, node.op, node.value);

  return {
    matched,
    evaluation_details: {
      attr: node.attr,
      actual_value: actualValue,
      expected: node.value,
      op: node.op,
    },
  };
}

/**
 * Validate that the RHS of a numeric time comparison is well-formed.
 * Rejects null, boolean, empty string, NaN, and non-array values for in/not_in.
 * Returns reason text on rejection so the failure message is actionable.
 */
function validateNumericRhs(op: TimeOp, value: unknown): { ok: true } | { ok: false; reason: string } {
  if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(value)) return { ok: false, reason: `${op} requires an array value, got ${typeof value}` };
    for (const v of value) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, reason: `${op} array contains non-numeric or non-finite element: ${String(v)}` };
      }
    }
    return { ok: true };
  }

  // Scalar numeric ops
  if (value === null) return { ok: false, reason: 'value is null' };
  if (typeof value === 'boolean') return { ok: false, reason: 'value is boolean (use == with a boolean attribute instead)' };
  if (typeof value === 'string' && value === '') return { ok: false, reason: 'value is empty string' };
  if (Array.isArray(value)) return { ok: false, reason: `${op} requires a scalar value, got array` };
  if (typeof value !== 'number') return { ok: false, reason: `value is ${typeof value}` };
  if (!Number.isFinite(value)) return { ok: false, reason: 'value is NaN or Infinity' };
  return { ok: true };
}

type ExtractResult =
  | { kind: 'value'; value: number | boolean }
  | { kind: 'absent' }
  | {
      kind: 'failure';
      failure: { reason_code: 'condition_node_evaluation_failed'; human_readable: string; details: Record<string, unknown>; user_action: string };
    };

function extractTimeAttr(attr: TimeCompareNode['attr'], ctx: EvaluationContext): ExtractResult {
  const now = ctx.now;

  switch (attr) {
    case 'now.day_of_week':
      return { kind: 'value', value: now.getUTCDay() }; // 0 = Sunday (UTC, phase-1)
    case 'now.hour_local':
      return { kind: 'value', value: now.getUTCHours() }; // UTC despite name (phase-1)
    case 'now.is_business_hours': {
      // Mon-Fri, 09:00-17:00 UTC (phase-1 — per-enterprise timezone deferred)
      const day = now.getUTCDay();
      const hour = now.getUTCHours();
      return { kind: 'value', value: day >= 1 && day <= 5 && hour >= 9 && hour < 17 };
    }
    case 'time_since_last_to_counterparty': {
      const lastTime = ctx.counterparty?.last_transfer_at;
      if (!lastTime) return { kind: 'absent' };
      const delta = now.getTime() - lastTime.getTime();
      if (delta < 0) {
        return {
          kind: 'failure',
          failure: {
            reason_code: 'condition_node_evaluation_failed',
            human_readable: `time_since_last_to_counterparty is negative (${delta}ms) — counterparty.last_transfer_at is in the future relative to context.now. This indicates clock skew or upstream data corruption.`,
            details: { delta_ms: delta, now: now.toISOString(), last_transfer_at: lastTime.toISOString() },
            user_action: 'Check the counterparty history loader for clock-skew or data-corruption issues.',
          },
        };
      }
      return { kind: 'value', value: delta };
    }
    case 'time_since_last_by_initiator':
      // Phase-1 limitation: loader for this attribute is deferred to plan 2.
      // Returning a structured failure (rather than silent matched=false)
      // surfaces the gap loudly so a rule author knows the attribute is unsupported.
      return {
        kind: 'failure',
        failure: {
          reason_code: 'condition_node_evaluation_failed',
          human_readable: 'time_since_last_by_initiator is not supported in phase 1 — the loader is deferred to plan 2.',
          details: { attr },
          user_action: 'Remove this attribute from the rule, or wait for plan 2 initiator-history support.',
        },
      };
    default:
      return assertNeverAttr(attr);
  }
}

function applyTimeOp(left: number | boolean, op: TimeOp, right: unknown): boolean {
  if (typeof left === 'boolean') {
    if (op === '==') return left === right;
    if (op === '!=') return left !== right;
    return false; // caller surfaces this as a structured failure
  }

  // Numeric
  if (op === 'in' || op === 'not_in') {
    if (!Array.isArray(right)) return false;
    const inList = (right as unknown[]).includes(left);
    return op === 'in' ? inList : !inList;
  }

  const r = typeof right === 'number' ? right : Number(right);
  if (Number.isNaN(r)) return false;

  switch (op) {
    case '==':
      return left === r;
    case '!=':
      return left !== r;
    case '>':
      return left > r;
    case '>=':
      return left >= r;
    case '<':
      return left < r;
    case '<=':
      return left <= r;
    default:
      return false;
  }
}

function assertNeverAttr(x: never): never {
  throw new Error(`Unhandled TimeAttribute: ${String(x)}`);
}
