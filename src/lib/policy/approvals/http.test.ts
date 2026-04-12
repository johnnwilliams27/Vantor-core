// src/lib/policy/approvals/http.test.ts

import { describe, it, expect } from 'vitest';
import { mapApprovalErrorToHttp } from './http';
import { ApprovalError } from './errors';

function makeError(reasonCode: string): ApprovalError {
  return new ApprovalError({
    reason_code: reasonCode as any,
    human_readable: `Error: ${reasonCode}`,
    user_action: 'Fix it.',
    details: { test: true },
  });
}

describe('mapApprovalErrorToHttp', () => {
  it('maps sod_initiator_conflict to 403', () => {
    const { status } = mapApprovalErrorToHttp(makeError('sod_initiator_conflict'));
    expect(status).toBe(403);
  });

  it('maps sod_rule_editor_conflict to 403', () => {
    const { status } = mapApprovalErrorToHttp(makeError('sod_rule_editor_conflict'));
    expect(status).toBe(403);
  });

  it('maps requires_policy_admin to 403', () => {
    const { status } = mapApprovalErrorToHttp(makeError('requires_policy_admin'));
    expect(status).toBe(403);
  });

  it('maps approval_not_pending to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('approval_not_pending'));
    expect(status).toBe(409);
  });

  it('maps sod_already_filled to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('sod_already_filled'));
    expect(status).toBe(409);
  });

  it('maps approval_concurrent_modification to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('approval_concurrent_modification'));
    expect(status).toBe(409);
  });

  it('maps stale_approval_reevaluation_failed to 409', () => {
    const { status } = mapApprovalErrorToHttp(makeError('stale_approval_reevaluation_failed'));
    expect(status).toBe(409);
  });

  it('maps no_matching_slot to 400', () => {
    const { status } = mapApprovalErrorToHttp(makeError('no_matching_slot'));
    expect(status).toBe(400);
  });

  it('includes structured body fields', () => {
    const err = makeError('sod_initiator_conflict');
    const { body } = mapApprovalErrorToHttp(err);

    expect(body.reason_code).toBe('sod_initiator_conflict');
    expect(body.human_readable).toBe('Error: sod_initiator_conflict');
    expect(body.user_action).toBe('Fix it.');
    expect(body.details).toEqual({ test: true });
  });
});
