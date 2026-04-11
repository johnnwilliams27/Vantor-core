// src/lib/policy/ir-evaluator/leaves/sanctions-status.ts

import { SanctionsStatusNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { LeafResult } from './amount-compare';

/**
 * Evaluate a sanctions_status leaf against the pre-loaded sanctions
 * snapshot in the evaluation context.
 *
 * Fail-closed: if the sanctions snapshot has a failure field set
 * (e.g., screening service unavailable), the leaf returns a structured
 * failure so the rule caller treats this as cannot-evaluate (block),
 * NOT as "not in the sanctioned list" (allow).
 */
export function evalSanctionsStatus(node: SanctionsStatusNode, ctx: EvaluationContext): LeafResult {
  if (ctx.sanctions.failure) {
    return {
      matched: false,
      failure: {
        reason_code: ctx.sanctions.failure.reason_code,
        human_readable: ctx.sanctions.failure.human_readable,
        details: ctx.sanctions.failure.details,
        user_action: 'Retry evaluation once the sanctions screening service is available.',
      },
      evaluation_details: { attr: 'sanctions_status' },
    };
  }

  const status = ctx.sanctions.status;
  const inList = node.values.includes(status);
  let matched: boolean;
  switch (node.op) {
    case 'in':
      matched = inList;
      break;
    case 'not_in':
      matched = !inList;
      break;
    default:
      return assertNeverOp(node.op);
  }

  return {
    matched,
    evaluation_details: {
      status,
      op: node.op,
      values: node.values,
    },
  };
}

function assertNeverOp(x: never): never {
  throw new Error(`Unhandled SanctionsStatusNode op: ${String(x)}`);
}
