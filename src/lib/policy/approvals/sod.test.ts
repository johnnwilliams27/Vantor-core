// src/lib/policy/approvals/sod.test.ts

import { describe, it, expect } from 'vitest';
import { validateSoD } from './sod';
import type { ApprovalRequest, SlotAssignment } from './types';
import type { ProposedMovement } from '../types/movement';

// ─── Fixtures ──────────────────────────────────────────────────────────

const MOVEMENT: ProposedMovement = {
  id: 'mov-001',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-initiator' },
  requested_at: '2026-04-12T00:00:00Z',
};

function makeSlot(index: number, minRole: string, filledBy?: string): SlotAssignment {
  return {
    slot_index: index,
    minimum_role: minRole,
    ...(filledBy ? { filled_by: filledBy, filled_at: '2026-04-12T01:00:00Z' } : {}),
  };
}

function makeRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'req-001',
    enterprise_id: 'ent-001',
    version_id: 'ver-001',
    movement_id: 'mov-001',
    proposed_movement: MOVEMENT,
    triggered_rule_ids: ['rule-1', 'rule-2'],
    chain_id: 'chain-001',
    slot_assignments: [
      makeSlot(0, 'treasury_manager'),
      makeSlot(1, 'treasury_manager'),
    ],
    status: 'pending',
    expires_at: '2026-04-13T00:00:00Z',
    created_by: 'user-initiator',
    created_at: '2026-04-12T00:00:00Z',
    version: 0,
    ...overrides,
  };
}

const EMPTY_RULE_AUTHORS = new Map<string, string>();

describe('validateSoD — configurable author-approver separation', () => {
  it('rejects rule-editor approver when separation is enabled (default)', () => {
    const request = makeRequest({
      triggered_rule_ids: ['rule-A'],
    });
    const result = validateSoD({
      request,
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors: new Map([['rule-A', 'user-editor']]),
      authorApproverSeparationEnabled: true,
    });
    expect(result).toEqual({ ok: false, reason_code: 'sod_rule_editor_conflict' });
  });

  it('allows rule-editor approver when separation is disabled', () => {
    // Same setup as the strict-enabled case — only the flag changes.
    const request = makeRequest({
      triggered_rule_ids: ['rule-A'],
    });
    const result = validateSoD({
      request,
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors: new Map([['rule-A', 'user-editor']]),
      authorApproverSeparationEnabled: false,
    });
    // Should fall through to finding a matching slot (slot 0 is treasury_manager min).
    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('initiator-conflict still fires even when separation is disabled', () => {
    // Disabling separation must NOT disable the initiator check — that
    // would let a user approve their own movement.
    const request = makeRequest({ created_by: 'user-self' });
    const result = validateSoD({
      request,
      approverId: 'user-self',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
      authorApproverSeparationEnabled: false,
    });
    expect(result).toEqual({ ok: false, reason_code: 'sod_initiator_conflict' });
  });

  it('defaults to strict when the flag is omitted (backward compat)', () => {
    const request = makeRequest({
      triggered_rule_ids: ['rule-A'],
    });
    const result = validateSoD({
      request,
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors: new Map([['rule-A', 'user-editor']]),
      // no authorApproverSeparationEnabled — should default to true
    });
    expect(result).toEqual({ ok: false, reason_code: 'sod_rule_editor_conflict' });
  });
});

describe('validateSoD — enterprise_admin strict exclusion', () => {
  it('rejects enterprise_admin approver with enterprise_admin_cannot_approve', () => {
    const request = makeRequest({
      created_by: 'user-initiator',
      slot_assignments: [makeSlot(0, 'treasury_manager')],
    });
    const result = validateSoD({
      request,
      approverId: 'user-admin',
      approverRole: 'enterprise_admin',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });
    expect(result).toEqual({
      ok: false,
      reason_code: 'enterprise_admin_cannot_approve',
    });
  });

  it('enterprise_admin check precedes all other SoD checks — fires even when the admin is also the initiator', () => {
    // If the exclusion check came AFTER initiator, this admin-as-initiator
    // case would resolve to sod_initiator_conflict and hide the real reason.
    // Strict-first ordering keeps the error specific and debuggable.
    const request = makeRequest({
      created_by: 'user-admin',
      slot_assignments: [makeSlot(0, 'treasury_manager')],
    });
    const result = validateSoD({
      request,
      approverId: 'user-admin',
      approverRole: 'enterprise_admin',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });
    expect(result).toEqual({
      ok: false,
      reason_code: 'enterprise_admin_cannot_approve',
    });
  });
});

describe('validateSoD', () => {
  it('returns ok with slot_index when all checks pass', () => {
    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('rejects with sod_initiator_conflict when approver is the initiator', () => {
    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-initiator',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_initiator_conflict' });
  });

  it('rejects with sod_rule_editor_conflict when approver authored a triggered rule', () => {
    const ruleAuthors = new Map([
      ['rule-1', 'user-editor'],
      ['rule-2', 'user-other'],
    ]);

    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_rule_editor_conflict' });
  });

  it('rejects with sod_already_filled when approver already filled a slot', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-approver'),
        makeSlot(1, 'treasury_manager'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_already_filled' });
  });

  it('rejects with no_matching_slot when approver role is too low', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'executive'),
        makeSlot(1, 'executive'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('rejects with no_matching_slot when all slots are already filled', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-other-1'),
        makeSlot(1, 'treasury_manager', 'user-other-2'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('picks the first unfilled slot matching the role', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-other'),
        makeSlot(1, 'accountant'),
        makeSlot(2, 'treasury_manager'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    // slot 0 is filled, slot 1 is accountant (treasury_manager >= accountant), so slot 1
    expect(result).toEqual({ ok: true, slot_index: 1 });
  });

  it('handles multiple slots with different role requirements', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'executive'),
        makeSlot(1, 'treasury_manager'),
        makeSlot(2, 'treasury_manager'),
      ],
    });

    // accountant can only fill the treasury_manager slot (no, accountant < treasury_manager)
    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'accountant',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('higher-rank user satisfies lower-rank slot minimum', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-exec',
      approverRole: 'executive',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('treasury_manager satisfies accountant slot', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'accountant'),
      ],
    });

    const result = validateSoD({
      request,
      approverId: 'user-mgr',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('initiator conflict takes precedence over rule editor conflict', () => {
    // Approver is both the initiator AND authored a triggering rule.
    // Should return initiator conflict (checked first).
    const ruleAuthors = new Map([['rule-1', 'user-initiator']]);

    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-initiator',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_initiator_conflict' });
  });

  it('rule editor conflict takes precedence over already-filled', () => {
    const request = makeRequest({
      slot_assignments: [
        makeSlot(0, 'treasury_manager', 'user-editor'),
        makeSlot(1, 'treasury_manager'),
      ],
    });
    const ruleAuthors = new Map([['rule-1', 'user-editor']]);

    const result = validateSoD({
      request,
      approverId: 'user-editor',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: false, reason_code: 'sod_rule_editor_conflict' });
  });

  it('handles request with no created_by (skips initiator check)', () => {
    const request = makeRequest({ created_by: undefined });

    const result = validateSoD({
      request,
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('rejects empty-string approverId (fail-safe precondition)', () => {
    // Defense: empty approverId could otherwise bypass initiator/rule-editor
    // checks if `request.created_by` or a rule author were also empty strings.
    const result = validateSoD({
      request: makeRequest({ created_by: '' }),
      approverId: '',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('rejects whitespace-only approverId', () => {
    const result = validateSoD({
      request: makeRequest(),
      approverId: '   ',
      approverRole: 'treasury_manager',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('ignores rule authors with empty-string user_id (defensive)', () => {
    // Corrupted DB row: rule.created_by is '' — we cannot attribute it, so
    // the rule-editor check is skipped for that rule, and the normal
    // checks continue.
    const ruleAuthors = new Map([
      ['rule-1', ''],
      ['rule-2', 'user-unrelated'],
    ]);

    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('rule not in ruleAuthors map is treated as unknown author (safe pass-through)', () => {
    // Map has rule-1 but not rule-2 -- .get('rule-2') returns undefined
    // and the `if (authorId && ...)` guard skips it safely.
    const ruleAuthors = new Map([['rule-1', 'user-other']]);

    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-approver',
      approverRole: 'treasury_manager',
      ruleAuthors,
    });

    expect(result).toEqual({ ok: true, slot_index: 0 });
  });

  it('role string is case-sensitive (typo does not grant bypass)', () => {
    const result = validateSoD({
      request: makeRequest(),
      approverId: 'user-approver',
      approverRole: 'Treasury_Manager', // uppercase typo
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });

  it('handles unknown role gracefully (no match)', () => {
    const request = makeRequest({
      slot_assignments: [makeSlot(0, 'treasury_manager')],
    });

    const result = validateSoD({
      request,
      approverId: 'user-unknown',
      approverRole: 'unknown_role',
      ruleAuthors: EMPTY_RULE_AUTHORS,
    });

    expect(result).toEqual({ ok: false, reason_code: 'no_matching_slot' });
  });
});
