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
  source: 'enterprise_admin' | 'vantor_staff';
}

/**
 * Read access to the currently active policy version. Any role,
 * including auditor, may view — viewing is strictly read-only and
 * carries no mutation risk.
 */
export function canViewActivePolicy(role: UserRole): boolean {
  return hasRole(role, 'auditor');
}

/**
 * Creating a new draft policy version. Authoring is now gated on
 * role === 'enterprise_admin' (pure role check). The legacy
 * `is_policy_admin` flag has been retired — migration 0049 upgraded
 * any user who relied on it to enterprise_admin, and the column
 * itself is dropped in a follow-up migration.
 *
 * Pre-RBAC hierarchy: treasury_manager + is_policy_admin=true. Any
 * current treasury_manager without the flag silently lost authoring
 * access when this landed (per product direction to ship and let
 * users discover).
 */
export function canCreateDraft(role: UserRole): boolean {
  return role === 'enterprise_admin';
}

export function canEditDraftRules(role: UserRole): boolean {
  return role === 'enterprise_admin';
}

export function canEditDraftChains(role: UserRole): boolean {
  return role === 'enterprise_admin';
}

/**
 * High-privilege gate used for policy activation and hard-limit
 * editing. Role is the primary gate; is_app_admin (Vantor staff)
 * is a bypass for platform-level elevation. The legacy
 * `is_policy_admin` column is no longer consulted.
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

  throw new AuthoringError({
    reason_code: REASON_CODES.requires_policy_admin,
    human_readable:
      'This action requires the enterprise_admin role. Only enterprise admins may edit hard limits or activate policy versions.',
    user_action:
      'Ask an existing enterprise admin to grant you the enterprise_admin role in Settings → Team, or request a Vantor staff elevation.',
    details: { user_id: userId },
  });
}
