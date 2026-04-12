import { describe, it, expect } from 'vitest';
import { mapAuthoringErrorToHttp } from './http';
import { AuthoringError } from './errors';

// Helper to build an AuthoringError with minimal required fields.
function makeError(reason_code: string, path?: (string | number)[]): AuthoringError {
  return new AuthoringError({
    reason_code: reason_code as AuthoringError['reason_code'],
    human_readable: 'Something went wrong',
    user_action: 'Check the request and try again',
    details: { field: 'example' },
    path,
  });
}

describe('mapAuthoringErrorToHttp', () => {
  // ── 403 ────────────────────────────────────────────────────────────────────

  it('maps requires_policy_admin → 403', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('requires_policy_admin'));
    expect(status).toBe(403);
  });

  // ── 409 ────────────────────────────────────────────────────────────────────

  it('maps version_not_draft → 409', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('version_not_draft'));
    expect(status).toBe(409);
  });

  it('maps activation_race_conflict → 409', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('activation_race_conflict'));
    expect(status).toBe(409);
  });

  it('maps stale_approval_chain_mismatch → 409', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('stale_approval_chain_mismatch'));
    expect(status).toBe(409);
  });

  it('maps activation_blocked_by_validation → 409', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('activation_blocked_by_validation'));
    expect(status).toBe(409);
  });

  it('maps chain_unsatisfiable_at_activation → 409', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('chain_unsatisfiable_at_activation'));
    expect(status).toBe(409);
  });

  // ── 400 (validation errors) ────────────────────────────────────────────────

  it('maps rule_priority_collision → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('rule_priority_collision'));
    expect(status).toBe(400);
  });

  it('maps chain_reference_not_found → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('chain_reference_not_found'));
    expect(status).toBe(400);
  });

  it('maps condition_ir_schema_invalid → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('condition_ir_schema_invalid'));
    expect(status).toBe(400);
  });

  it('maps hard_limit_value_out_of_range → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('hard_limit_value_out_of_range'));
    expect(status).toBe(400);
  });

  it('maps activation_reason_too_short → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('activation_reason_too_short'));
    expect(status).toBe(400);
  });

  it('maps usd_rule_on_rateless_asset → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('usd_rule_on_rateless_asset'));
    expect(status).toBe(400);
  });

  it('maps native_unit_currency_mismatch → 400', () => {
    const { status } = mapAuthoringErrorToHttp(makeError('native_unit_currency_mismatch'));
    expect(status).toBe(400);
  });

  // ── Response body shape ────────────────────────────────────────────────────

  it('body includes reason_code, human_readable, user_action, details, path', () => {
    const err = makeError('rule_priority_collision', ['rules', 0, 'priority']);
    const { body } = mapAuthoringErrorToHttp(err);

    expect(body).toMatchObject({
      reason_code: 'rule_priority_collision',
      human_readable: 'Something went wrong',
      user_action: 'Check the request and try again',
      details: { field: 'example' },
      path: ['rules', 0, 'priority'],
    });
  });

  it('body path defaults to empty array when not provided', () => {
    const err = makeError('rule_priority_collision');
    const { body } = mapAuthoringErrorToHttp(err);
    expect(body.path).toEqual([]);
  });
});
