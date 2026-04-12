import { UserRole } from '@/types/database';
import { hasRole } from '@/lib/auth/rbac';
import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringError } from './errors';

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        single: () => Promise<{ data: { is_policy_admin?: boolean; is_app_admin?: boolean } | null; error: unknown }>;
      };
    };
  };
};

export interface PolicyAdminResolution {
  source: 'policy_admin' | 'vantor_staff';
}

export function canViewActivePolicy(role: UserRole): boolean {
  return hasRole(role, 'auditor');
}

export function canCreateDraft(role: UserRole): boolean {
  return hasRole(role, 'treasury_manager');
}

export function canEditDraftRules(role: UserRole): boolean {
  return hasRole(role, 'treasury_manager');
}

export function canEditDraftChains(role: UserRole): boolean {
  return hasRole(role, 'treasury_manager');
}

export async function requirePolicyAdmin(
  supabase: SupabaseLike,
  userId: string,
): Promise<PolicyAdminResolution> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('is_policy_admin, is_app_admin')
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

  if (data.is_policy_admin) {
    return { source: 'policy_admin' };
  }

  throw new AuthoringError({
    reason_code: REASON_CODES.requires_policy_admin,
    human_readable:
      'This action requires policy admin permissions. Only users with is_policy_admin=true (or a Vantor staff member) may edit hard limits or activate policy versions.',
    user_action:
      'Ask an existing policy admin to grant you is_policy_admin in Settings → Team, or request a Vantor staff elevation.',
    details: { user_id: userId },
  });
}
