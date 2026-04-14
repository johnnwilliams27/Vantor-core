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
  it('returns true for auditor and higher (everyone — read is safe)', () => {
    expect(canViewActivePolicy('auditor')).toBe(true);
    expect(canViewActivePolicy('accountant')).toBe(true);
    expect(canViewActivePolicy('treasury_manager')).toBe(true);
    expect(canViewActivePolicy('executive')).toBe(true);
    expect(canViewActivePolicy('enterprise_admin')).toBe(true);
  });
});

describe('canCreateDraft / canEditDraftRules / canEditDraftChains', () => {
  it('returns true for enterprise_admin and executive (both are author roles)', () => {
    for (const role of ['enterprise_admin', 'executive'] as const) {
      expect(canCreateDraft(role)).toBe(true);
      expect(canEditDraftRules(role)).toBe(true);
      expect(canEditDraftChains(role)).toBe(true);
    }
  });

  it('returns false for non-author roles (auditor, accountant, treasury_manager)', () => {
    for (const role of ['auditor', 'accountant', 'treasury_manager'] as const) {
      expect(canCreateDraft(role)).toBe(false);
      expect(canEditDraftRules(role)).toBe(false);
      expect(canEditDraftChains(role)).toBe(false);
    }
  });
});

describe('requirePolicyAdmin', () => {
  it('resolves when the user has role=enterprise_admin', async () => {
    const supabase = mkSupabase({ role: 'enterprise_admin', is_app_admin: false });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'enterprise_admin',
    });
  });

  it('resolves when the user has role=executive', async () => {
    const supabase = mkSupabase({ role: 'executive', is_app_admin: false });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'executive',
    });
  });

  it('resolves when the user has is_app_admin=true (Vantor staff bypass)', async () => {
    // is_app_admin wins even when role is a non-admin — Vantor staff
    // elevation is independent of org role.
    const supabase = mkSupabase({ role: 'treasury_manager', is_app_admin: true });
    await expect(requirePolicyAdmin(supabase, 'user-1')).resolves.toMatchObject({
      source: 'vantor_staff',
    });
  });

  it('throws requires_policy_admin when role is auditor/accountant/treasury_manager and not app admin', async () => {
    for (const role of ['auditor', 'accountant', 'treasury_manager'] as const) {
      const supabase = mkSupabase({ role, is_app_admin: false });
      await expect(requirePolicyAdmin(supabase, 'user-1')).rejects.toMatchObject({
        reason_code: 'requires_policy_admin',
      });
    }
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

function mkSupabase(profile: { role: string; is_app_admin: boolean }) {
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
