import { describe, it, expect } from 'vitest';
import { AuthoringError } from './errors';
import { PolicyError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

describe('AuthoringError', () => {
  it('is a PolicyError with module=authoring and the caller-supplied reason_code', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.rule_priority_collision,
      human_readable: 'Two rules have priority 100 in this version.',
      user_action: 'Change the priority of one of the rules.',
      details: { version_id: 'v-1', colliding_priorities: [100] },
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err.reason_code).toBe('rule_priority_collision');
    expect(err.module).toBe('authoring');
    expect(err.name).toBe('AuthoringError');
    expect(err.details).toMatchObject({ version_id: 'v-1' });
  });

  it('carries an optional path for JSON-path error targeting', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.condition_ir_schema_invalid,
      human_readable: 'Condition value must be a string.',
      user_action: 'Remove the array from the value field.',
      details: {},
      path: ['rules', 0, 'condition', 'value'],
    });

    expect(err.path).toEqual(['rules', 0, 'condition', 'value']);
  });

  it('path defaults to empty array when not provided', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.requires_policy_admin,
      human_readable: 'x',
      user_action: 'y',
      details: {},
    });
    expect(err.path).toEqual([]);
  });

  it('serializes to JSON with path included', () => {
    const err = new AuthoringError({
      reason_code: REASON_CODES.version_not_draft,
      human_readable: 'Cannot edit a non-draft version.',
      user_action: 'Clone the version to create a new draft.',
      details: { version_id: 'v-1', status: 'active' },
      path: ['status'],
    });
    const json = err.toJSON() as Record<string, unknown>;
    expect(json.reason_code).toBe('version_not_draft');
    expect(json.path).toEqual(['status']);
  });
});
