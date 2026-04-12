// src/lib/policy/authoring/satisfiability.ts

import type { ApprovalChain } from '../types/policy-version';
import type { ApproverRole } from '../types/verdict';
import {
  ROLE_RANK,
  canFillSlot,
  type UserRole,
} from '@/lib/auth/roles';

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
 * Check whether an ApprovalChain can be satisfied by the given user
 * pool. Authoring-time check that matches the runtime behavior
 * enforced by src/lib/policy/approvals/sod.ts.
 *
 * Rules:
 *   - Empty slots array → unsatisfiable (authors must define at
 *     least one slot).
 *   - Each slot is filled by a **distinct user** from the pool. One
 *     user fills one slot; they cannot cover two slots even if their
 *     rank theoretically qualifies for both.
 *   - `enterprise_admin` users are EXCLUDED from the pool — strict
 *     separation of duties (the authors of policy cannot approve
 *     under it). Matches `canFillSlot`.
 *   - Unknown slot role strings → that slot is unsatisfiable. Users
 *     with unknown role strings are dropped from the pool.
 *
 * Greedy matching: sort slots by ascending rank, then for each slot
 * consume the lowest-rank eligible user. This preserves higher-rank
 * users for slots that actually need them — optimal for the
 * assignment problem when users are fungible within rank.
 */
export function checkChainSatisfiability(
  chain: ApprovalChain,
  users: SatisfiabilityUserRow[],
): ChainSatisfiabilityResult {
  const { id: chain_id, name: chain_name, slots } = chain;

  if (slots.length === 0) {
    return { chain_id, chain_name, satisfiable: false, unsatisfied_slots: [] };
  }

  // Eligible pool: drop enterprise_admin (strict SoD), drop users
  // whose role isn't in the canonical rank map. Track user_id
  // explicitly so the distinct-user accounting is obvious from
  // reading the code, not just implied by array length.
  const eligibleUsers = users
    .filter((u) => u.role !== 'enterprise_admin')
    .map((u) => ({ user_id: u.user_id, role: u.role, rank: ROLE_RANK[u.role] }))
    .filter((u) => typeof u.rank === 'number')
    .sort((a, b) => a.rank - b.rank);

  // Sort slots by ascending minimum rank so tightest constraints
  // are checked last (greedy match gives cheapest user first).
  const sortedSlots = [...slots].sort((a, b) => {
    const aRank = ROLE_RANK[a.minimum_role as ApproverRole];
    const bRank = ROLE_RANK[b.minimum_role as ApproverRole];
    return (aRank ?? -1) - (bRank ?? -1);
  });

  const unsatisfied_slots: number[] = [];
  const available = [...eligibleUsers];

  for (const slot of sortedSlots) {
    const slotRole = slot.minimum_role as ApproverRole;

    // Unknown slot role → always unsatisfiable. Guard before
    // canFillSlot so we don't paper over a typo'd role.
    if (ROLE_RANK[slotRole] === undefined) {
      unsatisfied_slots.push(slot.slot_index);
      continue;
    }

    // Find the lowest-ranked eligible user. canFillSlot consults
    // the same canonical hierarchy used at runtime, so
    // authoring-time and runtime verdicts stay in lockstep.
    const idx = available.findIndex((u) => canFillSlot(u.role, slotRole));
    if (idx === -1) {
      unsatisfied_slots.push(slot.slot_index);
    } else {
      // Consume the user — same user_id can never fill another slot.
      available.splice(idx, 1);
    }
  }

  const deduped = Array.from(new Set(unsatisfied_slots));

  return {
    chain_id,
    chain_name,
    satisfiable: deduped.length === 0,
    ...(deduped.length > 0 ? { unsatisfied_slots: deduped } : {}),
  };
}
