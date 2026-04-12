// src/lib/policy/authoring/satisfiability.ts

import type { UserRole } from '@/types/database';
import type { ApprovalChain } from '../types/policy-version';
import type { ApproverRole } from '../types/verdict';

export type SatisfiabilityUserRow = {
  user_id: string;
  role: UserRole;
};

export type ChainSatisfiabilityResult = {
  chain_id: string;
  chain_name: string;
  satisfiable: boolean;
  unsatisfied_slots?: number[];
};

/**
 * Role rank map. Includes Plan-2b roles (approver, executive) so they are
 * recognized even if no current user in the org holds them.
 *
 * auditor(0) < accountant(1) < treasury_manager(2) < approver(3) < executive(4)
 */
const ROLE_RANK: Record<ApproverRole, number> = {
  auditor: 0,
  accountant: 1,
  treasury_manager: 2,
  approver: 3,
  executive: 4,
} as Record<ApproverRole, number> & Record<string, number>;

/**
 * Return the numeric rank for a role string, or -1 if the role is unknown.
 */
function getRank(role: string): number {
  return (ROLE_RANK as Record<string, number>)[role] ?? -1;
}

/**
 * Check whether an ApprovalChain can be satisfied by the given user pool.
 *
 * Rules:
 *  - An empty slots array is unsatisfiable.
 *  - A user with rank >= slot.minimum_role rank can fill that slot.
 *  - Slots are filled greedily by minimum rank requirement; if N slots need
 *    at minimum role X, there must be at least N distinct users with rank >= X.
 */
export function checkChainSatisfiability(
  chain: ApprovalChain,
  users: SatisfiabilityUserRow[],
): ChainSatisfiabilityResult {
  const { id: chain_id, name: chain_name, slots } = chain;

  if (slots.length === 0) {
    return { chain_id, chain_name, satisfiable: false, unsatisfied_slots: [] };
  }

  // Sort slots by ascending minimum rank so tightest constraints are checked first.
  const sortedSlots = [...slots].sort(
    (a, b) => getRank(a.minimum_role) - getRank(b.minimum_role),
  );

  // Build a pool of user ranks (one entry per user).
  const userRanks = users.map((u) => getRank(u.role)).sort((a, b) => a - b);

  const unsatisfied_slots: number[] = [];

  // Greedy matching: for each slot (lowest rank first), consume the
  // lowest-ranked user that still meets the requirement. This is optimal
  // because using the cheapest-eligible user preserves higher-ranked users
  // for slots that require them.
  const available = [...userRanks];

  for (const slot of sortedSlots) {
    const required = getRank(slot.minimum_role);

    // Unknown role → always unsatisfiable
    if (required === -1) {
      unsatisfied_slots.push(slot.slot_index);
      continue;
    }

    const idx = available.findIndex((rank) => rank >= required);
    if (idx === -1) {
      unsatisfied_slots.push(slot.slot_index);
    } else {
      available.splice(idx, 1);
    }
  }

  // Deduplicate (slot_index should be unique but guard anyway).
  const deduped = [...new Set(unsatisfied_slots)];

  return {
    chain_id,
    chain_name,
    satisfiable: deduped.length === 0,
    ...(deduped.length > 0 ? { unsatisfied_slots: deduped } : {}),
  };
}
