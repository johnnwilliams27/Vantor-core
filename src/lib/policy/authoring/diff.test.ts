import { describe, it, expect } from 'vitest';
import { computeVersionDiff } from './diff';
import type { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import type { HardLimit } from '../types/hard-limit';

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

const mkRule = (overrides: Partial<PolicyRule> & { id: string }): PolicyRule => ({
  version_id: 'v1',
  rule_type: 'approval_threshold',
  name: 'Rule A',
  rationale: 'Standard threshold',
  condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '1000', currency: 'USD' } },
  verdict: 'require_approval',
  verdict_chain_id: 'chain-1',
  priority: 100,
  created_by: 'user-1',
  created_at: new Date('2026-01-01'),
  ...overrides,
});

const mkHardLimit = (overrides: Partial<HardLimit> & { id: string }): HardLimit => ({
  limit_type: 'min_cash_reserve_usd',
  name: 'Cash Floor',
  limit_value: '500000',
  limit_currency: 'USD',
  scope: {},
  ...overrides,
});

const mkChain = (overrides: Partial<ApprovalChain> & { id: string }): ApprovalChain => ({
  version_id: 'v1',
  name: 'Finance Approval',
  slots: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
  trigger_condition: undefined,
  priority: 10,
  expiration_hours: 48,
  created_by: 'user-1',
  created_at: new Date('2026-01-01'),
  ...overrides,
});

const mkSnapshot = (
  id: string,
  overrides: Partial<Pick<PolicyVersionSnapshot, 'rules' | 'hard_limits' | 'approval_chains'>> = {},
): PolicyVersionSnapshot => ({
  id,
  enterprise_id: 'ent-1',
  version_number: 1,
  status: 'draft',
  name: 'Test Policy',
  rules: [],
  hard_limits: [],
  approval_chains: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeVersionDiff', () => {
  it('returns empty diff when versions are identical', () => {
    const rule = mkRule({ id: 'r1' });
    const limit = mkHardLimit({ id: 'hl1' });
    const chain = mkChain({ id: 'ac1' });

    const before = mkSnapshot('v1', { rules: [rule], hard_limits: [limit], approval_chains: [chain] });
    const after = mkSnapshot('v2', { rules: [rule], hard_limits: [limit], approval_chains: [chain] });

    const diff = computeVersionDiff(before, after);

    expect(diff.from_version_id).toBe('v1');
    expect(diff.to_version_id).toBe('v2');
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.removed).toHaveLength(0);
    expect(diff.rules.modified).toHaveLength(0);
    expect(diff.hard_limits.added).toHaveLength(0);
    expect(diff.hard_limits.removed).toHaveLength(0);
    expect(diff.hard_limits.modified).toHaveLength(0);
    expect(diff.approval_chains.added).toHaveLength(0);
    expect(diff.approval_chains.removed).toHaveLength(0);
    expect(diff.approval_chains.modified).toHaveLength(0);
  });

  it('detects added rules', () => {
    const existing = mkRule({ id: 'r1' });
    const newRule = mkRule({ id: 'r2', name: 'New Rule' });

    const before = mkSnapshot('v1', { rules: [existing] });
    const after = mkSnapshot('v2', { rules: [existing, newRule] });

    const diff = computeVersionDiff(before, after);

    expect(diff.rules.added).toHaveLength(1);
    expect(diff.rules.added[0].id).toBe('r2');
    expect(diff.rules.removed).toHaveLength(0);
    expect(diff.rules.modified).toHaveLength(0);
  });

  it('detects removed rules', () => {
    const rule1 = mkRule({ id: 'r1' });
    const rule2 = mkRule({ id: 'r2', name: 'Rule to remove' });

    const before = mkSnapshot('v1', { rules: [rule1, rule2] });
    const after = mkSnapshot('v2', { rules: [rule1] });

    const diff = computeVersionDiff(before, after);

    expect(diff.rules.removed).toHaveLength(1);
    expect(diff.rules.removed[0].id).toBe('r2');
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.modified).toHaveLength(0);
  });

  it('detects modified rules and lists changed_fields', () => {
    const before_rule = mkRule({ id: 'r1', name: 'Old Name', priority: 100 });
    const after_rule = mkRule({ id: 'r1', name: 'New Name', priority: 200 });

    const before = mkSnapshot('v1', { rules: [before_rule] });
    const after = mkSnapshot('v2', { rules: [after_rule] });

    const diff = computeVersionDiff(before, after);

    expect(diff.rules.modified).toHaveLength(1);
    const mod = diff.rules.modified[0];
    expect(mod.before.id).toBe('r1');
    expect(mod.after.id).toBe('r1');
    expect(mod.changed_fields).toContain('name');
    expect(mod.changed_fields).toContain('priority');
    expect(mod.changed_fields).not.toContain('rule_type');
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.removed).toHaveLength(0);
  });

  it('detects hard limit changes', () => {
    const before_limit = mkHardLimit({ id: 'hl1', limit_value: '500000' });
    const after_limit = mkHardLimit({ id: 'hl1', limit_value: '750000' });
    const added_limit = mkHardLimit({ id: 'hl2', name: 'Daily Outflow Cap', limit_type: 'max_daily_outflow_usd' });

    const before = mkSnapshot('v1', { hard_limits: [before_limit] });
    const after = mkSnapshot('v2', { hard_limits: [after_limit, added_limit] });

    const diff = computeVersionDiff(before, after);

    expect(diff.hard_limits.added).toHaveLength(1);
    expect(diff.hard_limits.added[0].id).toBe('hl2');
    expect(diff.hard_limits.removed).toHaveLength(0);
    expect(diff.hard_limits.modified).toHaveLength(1);
    expect(diff.hard_limits.modified[0].changed_fields).toContain('limit_value');
  });

  it('detects approval chain changes', () => {
    const before_chain = mkChain({ id: 'ac1', expiration_hours: 48 });
    const after_chain = mkChain({ id: 'ac1', expiration_hours: 72, name: 'Updated Chain' });
    const removed_chain = mkChain({ id: 'ac2', name: 'Old Chain' });

    const before = mkSnapshot('v1', { approval_chains: [before_chain, removed_chain] });
    const after = mkSnapshot('v2', { approval_chains: [after_chain] });

    const diff = computeVersionDiff(before, after);

    expect(diff.approval_chains.removed).toHaveLength(1);
    expect(diff.approval_chains.removed[0].id).toBe('ac2');
    expect(diff.approval_chains.added).toHaveLength(0);
    expect(diff.approval_chains.modified).toHaveLength(1);
    const mod = diff.approval_chains.modified[0];
    expect(mod.changed_fields).toContain('expiration_hours');
    expect(mod.changed_fields).toContain('name');
  });

  it('records from_version_id and to_version_id correctly', () => {
    const before = mkSnapshot('before-uuid');
    const after = mkSnapshot('after-uuid');

    const diff = computeVersionDiff(before, after);

    expect(diff.from_version_id).toBe('before-uuid');
    expect(diff.to_version_id).toBe('after-uuid');
  });

  it('detects modified rules when condition changes', () => {
    const before_rule = mkRule({
      id: 'r1',
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '1000', currency: 'USD' } },
    });
    const after_rule = mkRule({
      id: 'r1',
      condition: { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '5000', currency: 'USD' } },
    });

    const before = mkSnapshot('v1', { rules: [before_rule] });
    const after = mkSnapshot('v2', { rules: [after_rule] });

    const diff = computeVersionDiff(before, after);

    expect(diff.rules.modified).toHaveLength(1);
    expect(diff.rules.modified[0].changed_fields).toContain('condition');
  });
});
