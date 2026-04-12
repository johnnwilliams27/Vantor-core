// src/lib/policy/approvals/sod.ts

import type { ReasonCode } from '../errors/reason-codes';
import { REASON_CODES } from '../errors/reason-codes';
import type { ApprovalRequest } from './types';
import { canFillSlot, type UserRole, type ApproverRole } from '@/lib/auth/roles';

export interface ValidateSoDParams {
  request: ApprovalRequest;
  approverId: string;
  /**
   * Caller-supplied role string (read from user_profiles.role or the
   * session). Typed as `string` because the DB column is a string enum
   * and upstream code hasn't always narrowed before reaching us.
   * `canFillSlot` safely returns false for unknown values.
   */
  approverRole: string;
  /** Map from rule_id to the user_id who created/last-edited that rule */
  ruleAuthors: Map<string, string>;
}

export type SoDResult =
  | { ok: true; slot_index: number }
  | { ok: false; reason_code: ReasonCode };

/**
 * Pure function: validates Separation of Duties for an approval action.
 *
 * Check order (first failure stops):
 * 0. enterprise_admin_cannot_approve — strict separation of duties:
 *    the role that authors policies cannot approve transfers under them
 * 1. sod_initiator_conflict — approver is the movement initiator
 * 2. sod_rule_editor_conflict — approver authored a triggering rule
 * 3. sod_already_filled — approver already filled a slot on this request
 * 4. no_matching_slot — no unfilled slot at the approver's role level
 *
 * Slot matching delegates to `canFillSlot` from `@/lib/auth/roles`, the
 * single source of truth for the role hierarchy.
 */
export function validateSoD(params: ValidateSoDParams): SoDResult {
  const { request, approverId, approverRole, ruleAuthors } = params;

  // Precondition (fail-safe): an empty/missing approverId can never approve.
  // Without this guard, an empty-string `created_by` in the DB would silently
  // disable the initiator check (because `'' && x === ''` short-circuits).
  if (!approverId || approverId.trim() === '') {
    return { ok: false, reason_code: REASON_CODES.no_matching_slot };
  }

  // 0. Strict separation of duties. Checked before any other SoD rule
  //    so the caller gets a specific, debuggable reason code rather
  //    than the generic `no_matching_slot` fallthrough.
  if (approverRole === 'enterprise_admin') {
    return { ok: false, reason_code: REASON_CODES.enterprise_admin_cannot_approve };
  }

  // 1. Initiator conflict
  if (request.created_by && approverId === request.created_by) {
    return { ok: false, reason_code: REASON_CODES.sod_initiator_conflict };
  }

  // 2. Rule editor conflict
  for (const ruleId of request.triggered_rule_ids) {
    const authorId = ruleAuthors.get(ruleId);
    if (authorId && authorId === approverId) {
      return { ok: false, reason_code: REASON_CODES.sod_rule_editor_conflict };
    }
  }

  // 3. Already filled a slot
  const alreadyFilled = request.slot_assignments.some(
    (slot) => slot.filled_by === approverId,
  );
  if (alreadyFilled) {
    return { ok: false, reason_code: REASON_CODES.sod_already_filled };
  }

  // 4. Find first unfilled slot matching the approver's role
  const matchingSlotIndex = request.slot_assignments.findIndex(
    (slot) =>
      !slot.filled_by &&
      canFillSlot(approverRole as UserRole, slot.minimum_role as ApproverRole),
  );
  if (matchingSlotIndex === -1) {
    return { ok: false, reason_code: REASON_CODES.no_matching_slot };
  }

  return { ok: true, slot_index: matchingSlotIndex };
}
