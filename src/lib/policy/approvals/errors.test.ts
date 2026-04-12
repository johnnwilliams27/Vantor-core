// src/lib/policy/approvals/errors.test.ts

import { describe, it, expect } from 'vitest';
import { ApprovalError } from './errors';
import { PolicyError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

describe('ApprovalError', () => {
  it('extends PolicyError with module=approvals', () => {
    const err = new ApprovalError({
      reason_code: REASON_CODES.approval_not_pending,
      human_readable: 'Request is not in pending status',
      user_action: 'Only pending requests can be approved.',
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err).toBeInstanceOf(ApprovalError);
    expect(err.name).toBe('ApprovalError');
    expect(err.module).toBe('approvals');
    expect(err.reason_code).toBe('approval_not_pending');
  });

  it('serializes to PolicyErrorEnvelope via toJSON()', () => {
    const err = new ApprovalError({
      reason_code: REASON_CODES.sod_initiator_conflict,
      human_readable: 'Approver is the movement initiator',
      user_action: 'A different user must approve this request.',
      details: { approver_id: 'user-1', initiator_id: 'user-1' },
    });

    const json = err.toJSON();
    expect(json.reason_code).toBe('sod_initiator_conflict');
    expect(json.module).toBe('approvals');
    expect(json.human_readable).toBe('Approver is the movement initiator');
    expect(json.user_action).toBe('A different user must approve this request.');
    expect(json.details).toEqual({ approver_id: 'user-1', initiator_id: 'user-1' });
    expect(json.occurred_at).toBeDefined();
  });

  it('includes cause chain when provided', () => {
    const cause = new Error('DB timeout');
    const err = new ApprovalError({
      reason_code: REASON_CODES.approval_concurrent_modification,
      human_readable: 'Concurrent modification detected',
      user_action: 'Retry the approval.',
      cause,
    });

    const json = err.toJSON();
    expect(json.cause).toEqual({ name: 'Error', message: 'DB timeout' });
  });

  it('message includes reason_code and human_readable', () => {
    const err = new ApprovalError({
      reason_code: REASON_CODES.no_matching_slot,
      human_readable: 'No matching slot for approver role',
      user_action: 'A user with a higher role must approve.',
    });

    expect(err.message).toBe('[no_matching_slot] No matching slot for approver role');
  });
});
