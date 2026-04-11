// src/lib/policy/ir-evaluator/leaves/string-compare.ts

import { StringCompareNode } from '../../types/ir';
import { ProposedMovement } from '../../types/movement';
import { LeafResult } from './amount-compare';

/**
 * Evaluate a string_compare leaf against a proposed movement.
 *
 * Reads a string attribute from the movement and compares it via
 * `==`/`!=`/`in`/`not_in`. Returns `matched: false` (no failure) when
 * the attribute is absent — "absent is not any specific value." Returns
 * a structured failure when the operator and value-shape are mismatched
 * (e.g., `==` with an array value), since that indicates a malformed
 * rule that should not silently approve transfers.
 */
export function evalStringCompare(node: StringCompareNode, movement: ProposedMovement): LeafResult {
  const actualValue = extractStringAttr(node.attr, movement);

  // Absent attributes: for ==/in we treat absent as "not any specific value"
  // and silently return matched=false. For !=/not_in we cannot honestly
  // say "the absent value is not in the list" (it's not in the universe at
  // all), so we return a structured failure — otherwise a "block transfers
  // without a trusted counterparty" rule via `counterparty_id != 'trusted'`
  // would silently allow them (matched=false → rule did not fire → no block).
  if (actualValue === undefined) {
    if (node.op === '!=' || node.op === 'not_in') {
      return {
        matched: false,
        failure: {
          reason_code: 'condition_node_evaluation_failed',
          human_readable: `string_compare attr="${node.attr}" is absent on this movement; op="${node.op}" cannot be evaluated against an absent value (would silently fail-open).`,
          details: { attr: node.attr, op: node.op },
          user_action: `Add an explicit existence guard before this rule, or use ==/in with an empty-string sentinel.`,
        },
        evaluation_details: { attr: node.attr, actual_value: null, op: node.op },
      };
    }
    return {
      matched: false,
      evaluation_details: { attr: node.attr, actual_value: null, op: node.op },
    };
  }

  // Validate value shape against operator. The schema should already
  // enforce this, but defense in depth: malformed rules should fail
  // structured rather than silently match (or silently not match).
  const valueIsArray = Array.isArray(node.value);
  const opExpectsArray = node.op === 'in' || node.op === 'not_in';
  if (valueIsArray !== opExpectsArray) {
    return {
      matched: false,
      failure: {
        reason_code: 'condition_node_evaluation_failed',
        human_readable: `string_compare op="${node.op}" with ${valueIsArray ? 'array' : 'scalar'} value is malformed. Use scalar with ==/!=, array with in/not_in.`,
        details: { attr: node.attr, op: node.op, value_shape: valueIsArray ? 'array' : 'scalar' },
        user_action: `Edit the rule: ${opExpectsArray ? 'wrap value in an array' : 'unwrap to a scalar'}.`,
      },
      evaluation_details: { attr: node.attr, op: node.op },
    };
  }

  let matched: boolean;
  switch (node.op) {
    case '==':
      matched = actualValue === (node.value as string);
      break;
    case '!=':
      matched = actualValue !== (node.value as string);
      break;
    case 'in':
      matched = (node.value as string[]).includes(actualValue);
      break;
    case 'not_in':
      matched = !(node.value as string[]).includes(actualValue);
      break;
    default:
      return assertNeverOp(node.op);
  }

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

function extractStringAttr(
  attr: StringCompareNode['attr'],
  movement: ProposedMovement,
): string | undefined {
  switch (attr) {
    case 'transfer.counterparty_id':
      return movement.counterparty?.id;
    case 'transfer.purpose_code':
      return movement.purpose_code;
    case 'transfer.initiator_type':
      return movement.initiator.type;
    case 'transfer.rail':
      return movement.rail;
    case 'transfer.source_venue':
      return movement.source.venue;
    case 'transfer.destination_venue':
      return movement.destination.venue;
    default:
      return assertNeverAttr(attr);
  }
}

function assertNeverOp(x: never): never {
  throw new Error(`Unhandled StringOp: ${String(x)}`);
}

function assertNeverAttr(x: never): never {
  throw new Error(`Unhandled StringAttribute: ${String(x)}`);
}
