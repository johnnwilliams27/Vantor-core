// src/lib/policy/gate/http.test.ts

import { describe, it, expect } from 'vitest';
import { mapGateErrorToHttp } from './http';
import { GateError } from './errors';

function makeError(reasonCode: string): GateError {
  return new GateError({
    reason_code: reasonCode as any,
    human_readable: `Error: ${reasonCode}`,
    user_action: 'Fix it.',
    details: { test: true },
  });
}

describe('mapGateErrorToHttp', () => {
  it('maps policy_blocked to 403', () => {
    expect(mapGateErrorToHttp(makeError('policy_blocked')).status).toBe(403);
  });

  it('maps hard_limit_breached to 403', () => {
    expect(mapGateErrorToHttp(makeError('hard_limit_breached')).status).toBe(403);
  });

  it('maps enterprise_mismatch to 403', () => {
    expect(mapGateErrorToHttp(makeError('enterprise_mismatch')).status).toBe(403);
  });

  it('maps policy_engine_unavailable to 503', () => {
    expect(mapGateErrorToHttp(makeError('policy_engine_unavailable')).status).toBe(503);
  });

  it('maps approval_creation_failed to 500', () => {
    expect(mapGateErrorToHttp(makeError('approval_creation_failed')).status).toBe(500);
  });

  it('maps canonicalization_failed to 400', () => {
    expect(mapGateErrorToHttp(makeError('canonicalization_failed')).status).toBe(400);
  });

  it('includes structured body fields', () => {
    const err = makeError('policy_blocked');
    const { body } = mapGateErrorToHttp(err);

    expect(body.reason_code).toBe('policy_blocked');
    expect(body.human_readable).toBe('Error: policy_blocked');
    expect(body.user_action).toBe('Fix it.');
    expect(body.details).toEqual({ test: true });
  });
});
