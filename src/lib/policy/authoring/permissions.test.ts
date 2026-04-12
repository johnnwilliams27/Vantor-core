import { describe, it, expect, vi } from 'vitest';
import {
  canViewActivePolicy,
  canCreateDraft,
  canEditDraftRules,
  canEditDraftChains,
  requirePolicyAdmin,
} from './permissions';
import { AuthoringError } from './errors';

describe('canViewActivePolicy', () => {
  it('returns true for auditor and higher', () => {
    expect(canViewActivePolicy('auditor')).toBe(true);
    expect(canViewActivePolicy('accountant')).toBe(true);
    expect(canViewActivePolicy('treasury_manager')).toBe(true);
  });
});

describe('canCreateDraft / canEditDraftRules / canEditDraftChains', () => {
  it('returns true only for treasury_manager and higher', () => {
    expect(canCreateDraft('auditor')).toBe(false);
    expect(canCreateDraft('accountant')).toBe(false);
    expect(canCreateDraft('treasury_manager')).toBe(true);

    expect(canEditDraftRules('auditor')).toBe(false);
    expect(canEditDraftRules('treasury_manager')).toBe(true);

    expect(canEditDraftChains('accountant')).toBe(false);
    expect(canEditDraftChains('treasury_manager')).toBe(true);
  });
});

describe('requirePolicyAdmin', () => {
  it('resolves when the user has is_policy_admin=true', async () => {
    const supabase = mkSupabase({ is_policy_admin: true, is_app_admin: false });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'policy_admin',
    });
  });

  it('resolves when the user has is_app_admin=true (with actor_source=vantor_staff)', async () => {
    const supabase = mkSupabase({ is_policy_admin: false, is_app_admin: true });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'vantor_staff',
    });
  });

  it('throws AuthoringError with reason_code=requires_policy_admin when neither flag is set', async () => {
    const supabase = mkSupabase({ is_policy_admin: false, is_app_admin: false });
    await expect(requirePolicyAdmin(supabase, 'user-1')).rejects.toMatchObject({
      reason_code: 'requires_policy_admin',
    });
  });

  it('throws when the user profile lookup returns no row', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
    await expect(requirePolicyAdmin(supabase as never, 'user-missing')).rejects.toBeInstanceOf(
      AuthoringError,
    );
  });
});

function mkSupabase(profile: { is_policy_admin: boolean; is_app_admin: boolean }) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: profile, error: null }),
        }),
      }),
    }),
  };
}
