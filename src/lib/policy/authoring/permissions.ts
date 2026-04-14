import { UserRole } from '@/types/database';
import { hasRole } from '@/lib/auth/rbac';
import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringError } from './errors';

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{
          data: { role?: UserRole; is_app_admin?: boolean } | null;
          error: unknown;
        }>;
      };
    };
  };
};

export interface PolicyAdminResolution {
  source: 'enterprise_admin' | 'executive' | 'vantor_staff';
}

/**
 * Roles allowed to author and activate policy versions. `executive`
 * is included alongside `enterprise_admin` so CFOs/treasurers can
 * draft rules and chains. Separation of duties is enforced at
 * approval time via `sod_rule_editor_conflict` — a user who authored
 * a triggering rule can't approve the resulting request when the
 * per-enterprise `author_approver_separation_enabled` flag is on
 * (default).
 */
const AUTHOR_ROLES = new Set<UserRole>(['enterprise_admin', 'executive']);

/**
 * Read access to the currently active policy version. Any role,
 * including auditor, may view — viewing is strictly read-only and
 * carries no mutation risk.
 */
export function canViewActivePolicy(role: UserRole): boolean {
  return hasRole(role, 'auditor');
}

/**
 * Creating a new draft policy version. Gated on author roles. The
 * legacy `is_policy_admin` flag was retired in migration 0049.
 */
export function canCreateDraft(role: UserRole): boolean {
  return AUTHOR_ROLES.has(role);
}

export function canEditDraftRules(role: UserRole): boolean {
  return AUTHOR_ROLES.has(role);
}

export function canEditDraftChains(role: UserRole): boolean {
  return AUTHOR_ROLES.has(role);
}

/**
 * High-privilege gate used for policy activation and hard-limit
 * editing. Role is the primary gate; `is_app_admin` (Vantor staff)
 * is a bypass for platform-level elevation.
 *
 * Allowed:
 *   - enterprise_admin (authoring role)
 *   - executive (CFO/treasurer tier; may author + activate)
 *   - any user with is_app_admin=true (Vantor staff bypass)
 */
export async function requirePolicyAdmin(
  supabase: SupabaseLike,
  userId: string,
): Promise<PolicyAdminResolution> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('role, is_app_admin')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new AuthoringError({
      reason_code: REASON_CODES.requires_policy_admin,
      human_readable: 'Could not verify policy admin permissions: user profile not found.',
      user_action: 'Contact an app admin to ensure your user profile exists.',
      details: { user_id: userId },
    });
  }

  if (data.is_app_admin) {
    return { source: 'vantor_staff' };
  }

  if (data.role === 'enterprise_admin') {
    return { source: 'enterprise_admin' };
  }

  if (data.role === 'executive') {
    return { source: 'executive' };
  }

  throw new AuthoringError({
    reason_code: REASON_CODES.requires_policy_admin,
    human_readable:
      'This action requires the enterprise_admin or executive role. Only those roles may edit hard limits or activate policy versions.',
    user_action:
      'Ask an existing enterprise admin to grant you the enterprise_admin or executive role in Settings → Team, or request a Vantor staff elevation.',
    details: { user_id: userId },
  });
}
