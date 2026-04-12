// src/lib/policy/approvals/sod.ts

import type { ReasonCode } from '../errors/reason-codes';
import { REASON_CODES } from '../errors/reason-codes';
import type { ApprovalRequest } from './types';

/**
 * Combined role rank for SoD slot matching. Includes both UserRole
 * values (auditor, accountant, treasury_manager) and ApproverRole
 * values (approver, executive). The existing `hasRole` from
 * `src/lib/auth/rbac.ts` only handles UserRole, so we maintain a
 * local rank map that covers the full slot role spectrum.
 */
const COMBINED_ROLE_RANK: Record<string, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
  approver: 3,
  executive: 4,
};

function roleRankOf(role: string): number {
  return COMBINED_ROLE_RANK[role] ?? -1;
}

function roleSatisfiesSlot(approverRole: string, slotMinimumRole: string): boolean {
  const approverRank = roleRankOf(approverRole);
  const slotRank = roleRankOf(slotMinimumRole);
  if (approverRank < 0 || slotRank < 0) return false;
  return approverRank >= slotRank;
}

export interface ValidateSoDParams {
  request: ApprovalRequest;
  approverId: string;
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
 * 1. sod_initiator_conflict - approver is the movement initiator
 * 2. sod_rule_editor_conflict - approver authored a triggering rule
 * 3. sod_already_filled - approver already filled a slot on this request
 * 4. no_matching_slot - no unfilled slot at the approver's role level
 */
export function validateSoD(params: ValidateSoDParams): SoDResult {
  const { request, approverId, approverRole, ruleAuthors } = params;

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
    (slot) => !slot.filled_by && roleSatisfiesSlot(approverRole, slot.minimum_role),
  );
  if (matchingSlotIndex === -1) {
    return { ok: false, reason_code: REASON_CODES.no_matching_slot };
  }

  return { ok: true, slot_index: matchingSlotIndex };
}
