import { describe, it, expect } from 'vitest';
import {
  APPROVER_ROLES,
  ALL_ROLES,
  ROLE_RANK,
  canFillSlot,
  isApproverRole,
  ENTERPRISE_ADMIN_CANNOT_APPROVE,
  AUDITOR_CANNOT_APPROVE,
  type UserRole,
  type ApproverRole,
} from './roles';

/**
 * Tests for the single-source-of-truth roles module.
 *
 * Coverage goals:
 *   1. Shape: constants, rank, types stay in lockstep
 *   2. canFillSlot: full 5 × 3 truth table (every UserRole × every
 *      ApproverRole) plus the two strict exclusions (auditor +
 *      enterprise_admin)
 *   3. isApproverRole: all roles
 */

// ─── Shape ───────────────────────────────────────────────────────────

describe('APPROVER_ROLES + ALL_ROLES', () => {
  it('APPROVER_ROLES is lowest-to-highest: accountant, treasury_manager, executive', () => {
    // auditor is NOT in APPROVER_ROLES — read-only reviewer role.
    expect(APPROVER_ROLES).toEqual(['accountant', 'treasury_manager', 'executive']);
  });

  it('ALL_ROLES = auditor + APPROVER_ROLES + enterprise_admin (in that order)', () => {
    expect(ALL_ROLES).toEqual([
      'auditor',
      'accountant',
      'treasury_manager',
      'executive',
      'enterprise_admin',
    ]);
  });

  it('every APPROVER_ROLES member is also in ALL_ROLES', () => {
    for (const role of APPROVER_ROLES) {
      expect(ALL_ROLES).toContain(role);
    }
  });

  it('auditor is in ALL_ROLES but NOT in APPROVER_ROLES', () => {
    expect(ALL_ROLES).toContain('auditor');
    expect(APPROVER_ROLES as readonly string[]).not.toContain('auditor');
  });
});

describe('ROLE_RANK', () => {
  it('has an entry for every UserRole', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_RANK).toHaveProperty(role);
      expect(typeof ROLE_RANK[role]).toBe('number');
    }
  });

  it('ranks are strictly increasing in the documented order', () => {
    expect(ROLE_RANK.auditor).toBeLessThan(ROLE_RANK.accountant);
    expect(ROLE_RANK.accountant).toBeLessThan(ROLE_RANK.treasury_manager);
    expect(ROLE_RANK.treasury_manager).toBeLessThan(ROLE_RANK.executive);
    expect(ROLE_RANK.executive).toBeLessThan(ROLE_RANK.enterprise_admin);
  });

  it('executive sits strictly between treasury_manager and enterprise_admin', () => {
    expect(ROLE_RANK.executive).toBeGreaterThan(ROLE_RANK.treasury_manager);
    expect(ROLE_RANK.executive).toBeLessThan(ROLE_RANK.enterprise_admin);
  });
});

// ─── canFillSlot — truth table ───────────────────────────────────────

describe('canFillSlot', () => {
  // Positive cases — role rank >= slot minimum rank, and role is not
  // in the excluded set (auditor, enterprise_admin).
  it.each<[UserRole, ApproverRole]>([
    ['accountant', 'accountant'],
    ['treasury_manager', 'accountant'],
    ['treasury_manager', 'treasury_manager'],
    ['executive', 'accountant'],
    ['executive', 'treasury_manager'],
    ['executive', 'executive'],
  ])('allows %s to fill a %s-minimum slot', (userRole, slotRole) => {
    expect(canFillSlot(userRole, slotRole)).toBe(true);
  });

  // Negative cases — user rank below slot minimum
  it.each<[UserRole, ApproverRole]>([
    ['accountant', 'treasury_manager'],
    ['accountant', 'executive'],
    ['treasury_manager', 'executive'],
  ])('rejects %s trying to fill a %s-minimum slot (rank too low)', (userRole, slotRole) => {
    expect(canFillSlot(userRole, slotRole)).toBe(false);
  });

  // Strict auditor exclusion — read-only reviewer, never approves.
  it.each<ApproverRole>(['accountant', 'treasury_manager', 'executive'])(
    'strictly excludes auditor from filling a %s-minimum slot (read-only role)',
    (slotRole) => {
      expect(canFillSlot('auditor', slotRole)).toBe(false);
    },
  );

  // Strict enterprise_admin exclusion — highest rank but always rejected.
  it.each<ApproverRole>(['accountant', 'treasury_manager', 'executive'])(
    'strictly excludes enterprise_admin from filling a %s-minimum slot (SoD)',
    (slotRole) => {
      expect(canFillSlot('enterprise_admin', slotRole)).toBe(false);
    },
  );

  it('enumerates the expected truth-table shape', () => {
    // 5 UserRoles × 3 ApproverRoles = 15 combinations.
    const expectedCount = ALL_ROLES.length * APPROVER_ROLES.length;
    expect(expectedCount).toBe(5 * 3);
  });
});

// ─── isApproverRole ──────────────────────────────────────────────────

describe('isApproverRole', () => {
  it.each<UserRole>(['accountant', 'treasury_manager', 'executive'])(
    'returns true for %s',
    (role) => {
      expect(isApproverRole(role)).toBe(true);
    },
  );

  it('returns false for auditor (read-only reviewer)', () => {
    expect(isApproverRole('auditor')).toBe(false);
  });

  it('returns false for enterprise_admin (SoD)', () => {
    expect(isApproverRole('enterprise_admin')).toBe(false);
  });
});

// ─── Reason-code exports ─────────────────────────────────────────────

describe('reason-code constants', () => {
  it('ENTERPRISE_ADMIN_CANNOT_APPROVE matches the policy reason-code string', () => {
    expect(ENTERPRISE_ADMIN_CANNOT_APPROVE).toBe('enterprise_admin_cannot_approve');
  });
  it('AUDITOR_CANNOT_APPROVE matches the policy reason-code string', () => {
    expect(AUDITOR_CANNOT_APPROVE).toBe('auditor_cannot_approve');
  });
});
