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
 *
 * `auditor` is NOT in this list — auditors are read-only reviewers
 * who observe evaluations and transfers but cannot approve them. A
 * chain that still references minimum_role='auditor' in the DB (from
 * before this exclusion) can be filled by any higher rank (accountant+)
 * but never by an auditor.
 */
export const APPROVER_ROLES = [
  'accountant',
  'treasury_manager',
  'executive',
] as const;

/**
 * All roles in the system. Two exclusions apply in `canFillSlot`:
 *   - `auditor` — read-only reviewer; cannot approve.
 *   - `enterprise_admin` — highest rank, strictly excluded (policy
 *     author cannot also approve under the policy).
 */
export const ALL_ROLES = [
  'auditor',
  ...APPROVER_ROLES,
  'enterprise_admin',
] as const;

export type ApproverRole = (typeof APPROVER_ROLES)[number];
export type UserRole = (typeof ALL_ROLES)[number];

/**
 * Monotonic rank. Higher rank = broader approval coverage. Auditor
 * and enterprise_admin have ranks only for UI ordering — both are
 * excluded from approval by `canFillSlot`.
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
 * Three rules, in order:
 *   1. `auditor` can NEVER fill a slot (read-only reviewer).
 *   2. `enterprise_admin` can NEVER fill a slot (strict separation —
 *      authoring role must not also approve).
 *   3. Otherwise, user rank must be >= slot's minimum rank.
 */
export function canFillSlot(userRole: UserRole, slotMinimumRole: ApproverRole): boolean {
  if (userRole === 'auditor') return false;
  if (userRole === 'enterprise_admin') return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[slotMinimumRole];
}

/**
 * Type guard — narrows a UserRole to the approver subset. Useful
 * when UI code needs to decide whether to show approval-eligible
 * affordances.
 */
export function isApproverRole(role: UserRole): role is ApproverRole {
  return role !== 'auditor' && role !== 'enterprise_admin';
}

/**
 * Reason-code constants for explicit role exclusions. Kept here so UI
 * layers can surface a consistent string without importing from the
 * policy module.
 */
export const ENTERPRISE_ADMIN_CANNOT_APPROVE = 'enterprise_admin_cannot_approve' as const;
export const AUDITOR_CANNOT_APPROVE = 'auditor_cannot_approve' as const;

/**
 * Whether a user with the given role can manage billing (view invoices,
 * upgrade/downgrade tier, update payment method). Requires rank >=
 * treasury_manager — auditors and accountants are excluded.
 */
export function canManageBilling(role: string): boolean {
  const rank = ROLE_RANK[role as UserRole];
  return rank != null && rank >= ROLE_RANK.treasury_manager;
}
