/**
 * Single source of truth for Vantor's role system.
 *
 * Every file that needs to reason about roles — rank comparisons,
 * approval-slot eligibility, route gating, DB-typed `role` columns —
 * should import from here. This module is the authority; other
 * places (types/database.ts, policy/approvals/sod.ts,
 * policy/types/verdict.ts, policy/authoring/validation.ts) re-export
 * or consume from it.
 *
 * Two unions, one hierarchy:
 *
 *   UserRole       — every role that can appear in user_profiles.role
 *   ApproverRole   — subset that is eligible to fill approval slots
 *
 * `enterprise_admin` is a UserRole but NOT an ApproverRole.
 * Strict separation of duties: the role that authors policies cannot
 * approve transfers under them.
 *
 * DB alignment: the `user_role` enum in postgres must match
 * `ALL_ROLES` 1:1. `executive` is added to the enum in migration
 * 0049_rbac_hierarchy.sql.
 */

/**
 * Roles eligible to fill approval chain slots, ordered lowest rank
 * (least power) to highest rank (most power). Preserve this order —
 * `ROLE_RANK` derives rank from array index.
 */
export const APPROVER_ROLES = [
  'auditor',
  'accountant',
  'treasury_manager',
  'executive',
] as const;

/**
 * All roles in the system. `enterprise_admin` is the highest by rank
 * but strictly excluded from approval by `canFillSlot`.
 */
export const ALL_ROLES = [...APPROVER_ROLES, 'enterprise_admin'] as const;

export type ApproverRole = (typeof APPROVER_ROLES)[number];
export type UserRole = (typeof ALL_ROLES)[number];

/**
 * Monotonic rank. Higher rank = broader approval coverage.
 * `enterprise_admin` has the highest numeric rank purely for UI
 * ordering; `canFillSlot` excludes it regardless of rank.
 */
export const ROLE_RANK: Record<UserRole, number> = {
  auditor: 1,
  accountant: 2,
  treasury_manager: 3,
  executive: 4,
  enterprise_admin: 5,
};

/**
 * Whether a user with the given role can fill an approval slot that
 * requires `slotMinimumRole` or higher.
 *
 * Two rules, in order:
 *   1. `enterprise_admin` can NEVER fill a slot (strict separation).
 *   2. Otherwise, user rank must be >= slot's minimum rank.
 */
export function canFillSlot(userRole: UserRole, slotMinimumRole: ApproverRole): boolean {
  if (userRole === 'enterprise_admin') return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[slotMinimumRole];
}

/**
 * Type guard — narrows a UserRole to the approver subset. Useful
 * when UI code needs to decide whether to show approval-eligible
 * affordances.
 */
export function isApproverRole(role: UserRole): role is ApproverRole {
  return role !== 'enterprise_admin';
}

/**
 * Reason code constant for the explicit `enterprise_admin` exclusion.
 * Kept here (not buried in sod.ts) so UI layers can surface a
 * consistent string without importing from the policy module.
 */
export const ENTERPRISE_ADMIN_CANNOT_APPROVE = 'enterprise_admin_cannot_approve' as const;
