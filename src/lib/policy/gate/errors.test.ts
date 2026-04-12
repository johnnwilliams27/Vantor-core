// src/lib/policy/gate/errors.test.ts

import { describe, it, expect } from 'vitest';
import { GateError } from './errors';
import { PolicyError } from '../errors/classes';
import { REASON_CODES } from '../errors/reason-codes';

describe('GateError', () => {
  it('extends PolicyError with module=gate', () => {
    const err = new GateError({
      reason_code: REASON_CODES.policy_blocked,
      human_readable: 'Transfer blocked by policy rule "No transfers above $100k"',
      user_action: 'Request a treasurer override or reduce the transfer amount.',
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err).toBeInstanceOf(GateError);
    expect(err.name).toBe('GateError');
    expect(err.module).toBe('gate');
    expect(err.reason_code).toBe('policy_blocked');
  });

  it('serializes to envelope with details and cause', () => {
    const cause = new Error('engine DB timeout');
    const err = new GateError({
      reason_code: REASON_CODES.policy_engine_unavailable,
      human_readable: 'Policy engine unavailable.',
      user_action: 'Retry in a few seconds.',
      details: { enterprise_id: 'ent-1' },
      cause,
    });

    const json = err.toJSON();
    expect(json.reason_code).toBe('policy_engine_unavailable');
    expect(json.module).toBe('gate');
    expect(json.details).toEqual({ enterprise_id: 'ent-1' });
    expect(json.cause).toEqual({ name: 'Error', message: 'engine DB timeout' });
  });

  it('message follows [reason_code] human_readable format', () => {
    const err = new GateError({
      reason_code: REASON_CODES.hard_limit_breached,
      human_readable: 'Daily outflow limit reached.',
      user_action: 'Wait until tomorrow.',
    });

    expect(err.message).toBe('[hard_limit_breached] Daily outflow limit reached.');
  });
});
