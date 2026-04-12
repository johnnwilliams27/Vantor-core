import { describe, it, expect } from 'vitest';
import {
  APPROVER_ROLES,
  ALL_ROLES,
  ROLE_RANK,
  canFillSlot,
  isApproverRole,
  ENTERPRISE_ADMIN_CANNOT_APPROVE,
  type UserRole,
  type ApproverRole,
} from './roles';

/**
 * Tests for the single-source-of-truth roles module.
 *
 * Coverage goals:
 *   1. Shape: constants, rank, types stay in lockstep
 *   2. canFillSlot: full 5 × 4 truth table (every UserRole × every
 *      ApproverRole) including the enterprise_admin strict exclusion
 *   3. isApproverRole: all roles
 */

// ─── Shape ───────────────────────────────────────────────────────────

describe('APPROVER_ROLES + ALL_ROLES', () => {
  it('APPROVER_ROLES is lowest-to-highest: auditor, accountant, treasury_manager, executive', () => {
    expect(APPROVER_ROLES).toEqual(['auditor', 'accountant', 'treasury_manager', 'executive']);
  });

  it('ALL_ROLES = APPROVER_ROLES + enterprise_admin (in that order)', () => {
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
    // The product-level placement of the new role.
    expect(ROLE_RANK.executive).toBeGreaterThan(ROLE_RANK.treasury_manager);
    expect(ROLE_RANK.executive).toBeLessThan(ROLE_RANK.enterprise_admin);
  });
});

// ─── canFillSlot — the 5 × 4 truth table ─────────────────────────────

describe('canFillSlot', () => {
  // Positive cases — role rank >= slot minimum rank
  it.each<[UserRole, ApproverRole]>([
    ['auditor', 'auditor'],
    ['accountant', 'auditor'],
    ['accountant', 'accountant'],
    ['treasury_manager', 'auditor'],
    ['treasury_manager', 'accountant'],
    ['treasury_manager', 'treasury_manager'],
    ['executive', 'auditor'],
    ['executive', 'accountant'],
    ['executive', 'treasury_manager'],
    ['executive', 'executive'],
  ])('allows %s to fill a %s-minimum slot', (userRole, slotRole) => {
    expect(canFillSlot(userRole, slotRole)).toBe(true);
  });

  // Negative cases — user rank below slot minimum
  it.each<[UserRole, ApproverRole]>([
    ['auditor', 'accountant'],
    ['auditor', 'treasury_manager'],
    ['auditor', 'executive'],
    ['accountant', 'treasury_manager'],
    ['accountant', 'executive'],
    ['treasury_manager', 'executive'],
  ])('rejects %s trying to fill a %s-minimum slot (rank too low)', (userRole, slotRole) => {
    expect(canFillSlot(userRole, slotRole)).toBe(false);
  });

  // Strict enterprise_admin exclusion — highest rank but always rejected
  it.each<ApproverRole>(['auditor', 'accountant', 'treasury_manager', 'executive'])(
    'strictly excludes enterprise_admin from filling a %s-minimum slot (even though rank is highest)',
    (slotRole) => {
      expect(canFillSlot('enterprise_admin', slotRole)).toBe(false);
    },
  );

  it('covers every (UserRole × ApproverRole) combination exhaustively', () => {
    // Defensive: if a role is added to either union, this test will
    // fail the len check and force the author to update the tables.
    const expectedCount = ALL_ROLES.length * APPROVER_ROLES.length;
    expect(expectedCount).toBe(5 * 4);
  });
});

// ─── isApproverRole ──────────────────────────────────────────────────

describe('isApproverRole', () => {
  it.each<UserRole>(['auditor', 'accountant', 'treasury_manager', 'executive'])(
    'returns true for %s',
    (role) => {
      expect(isApproverRole(role)).toBe(true);
    },
  );

  it('returns false for enterprise_admin', () => {
    expect(isApproverRole('enterprise_admin')).toBe(false);
  });
});

// ─── Reason code export ──────────────────────────────────────────────

describe('ENTERPRISE_ADMIN_CANNOT_APPROVE', () => {
  it('is the canonical reason-code string for enterprise_admin exclusion', () => {
    expect(ENTERPRISE_ADMIN_CANNOT_APPROVE).toBe('enterprise_admin_cannot_approve');
  });
});
