// src/lib/policy/gate/gate.test.ts

import { describe, it, expect, vi } from 'vitest';
import { PolicyGateService, type GateActor } from './gate';
import { GateError } from './errors';
import { REASON_CODES } from '../errors/reason-codes';
import type { ProposedMovement } from '../types/movement';
import type { EvaluationResult, ResolvedApprovalChain } from '../types/verdict';
import type { ApprovalRequest, ApprovalWorkflowService } from '../approvals';

// ─── Fixtures ──────────────────────────────────────────────────────────

const MOVEMENT: ProposedMovement = {
  id: 'mov-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
  amount: { amount: '10000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: '2026-04-12T00:00:00Z',
};

const ACTOR: GateActor = {
  user_id: 'user-1',
  role: 'treasury_manager',
  enterprise_id: 'ent-1',
};

const CHAIN: ResolvedApprovalChain = {
  chain_id: 'chain-1',
  chain_name: 'Dual Approval',
  slots: [
    { slot_index: 0, minimum_role: 'treasury_manager' },
    { slot_index: 1, minimum_role: 'treasury_manager' },
  ],
  expiration_hours: 24,
};

const APPROVAL_REQUEST: ApprovalRequest = {
  id: 'req-1',
  enterprise_id: 'ent-1',
  version_id: 'ver-1',
  movement_id: 'mov-1',
  proposed_movement: MOVEMENT,
  triggered_rule_ids: ['rule-1'],
  chain_id: 'chain-1',
  slot_assignments: [
    { slot_index: 0, minimum_role: 'treasury_manager' },
    { slot_index: 1, minimum_role: 'treasury_manager' },
  ],
  status: 'pending',
  expires_at: '2026-04-13T00:00:00Z',
  created_by: 'user-1',
  created_at: '2026-04-12T00:00:00Z',
  version: 0,
};

const SUPABASE: any = { from: () => ({}) };

function mockApprovalService(overrides?: Partial<ApprovalWorkflowService>): ApprovalWorkflowService {
  return {
    createApprovalRequest: vi.fn().mockResolvedValue(APPROVAL_REQUEST),
    ...overrides,
  } as unknown as ApprovalWorkflowService;
}

function makeTrace(overrides?: Record<string, unknown>) {
  return {
    policy_version_id: 'ver-1',
    triggered_rule_ids: ['rule-1'],
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('PolicyGateService', () => {
  it('returns { verdict: "allow_auto", evaluation } on allow_auto', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'allow_auto',
      trace: makeTrace(),
      reason_codes: [],
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('allow_auto');
    expect(approvalService.createApprovalRequest).not.toHaveBeenCalled();
    if (result.verdict === 'allow_auto') {
      expect(result.evaluation.verdict).toBe('allow_auto');
    }
  });

  it('creates an approval request on require_approval', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('require_approval');
    if (result.verdict === 'require_approval') {
      expect(result.approval_request).toEqual(APPROVAL_REQUEST);
    }
    expect(approvalService.createApprovalRequest).toHaveBeenCalledTimes(1);
    expect(approvalService.createApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        enterprise_id: 'ent-1',
        movement_id: 'mov-1',
        chain: CHAIN,
        triggered_rule_ids: ['rule-1'],
        created_by: 'user-1',
      }),
    );
  });

  it('throws policy_blocked on verdict=block', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'block',
      trace: makeTrace(),
      reason_codes: ['sanctioned_counterparty'],
    } as EvaluationResult);

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    await expect(gate.gate(MOVEMENT, ACTOR)).rejects.toThrow(GateError);

    try {
      await gate.gate(MOVEMENT, ACTOR);
    } catch (err) {
      expect((err as GateError).reason_code).toBe('policy_blocked');
      expect((err as GateError).details.reason_codes).toEqual(['sanctioned_counterparty']);
    }
  });

  it('throws hard_limit_breached on verdict=block_hard_limit', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'block_hard_limit',
      trace: makeTrace(),
      reason_codes: ['max_daily_outflow_usd'],
    } as EvaluationResult);

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('hard_limit_breached');
    }
  });

  it('throws policy_engine_unavailable when evaluate rejects with a generic error', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('DB timeout'));

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('policy_engine_unavailable');
    }
  });

  it('throws canonicalization_failed when evaluate rejects with that reason code', async () => {
    const evaluate = vi.fn().mockRejectedValue({
      reason_code: REASON_CODES.canonicalization_failed,
      message: 'stale rate',
    });

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('canonicalization_failed');
    }
  });

  it('throws approval_creation_failed when createApprovalRequest rejects', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = {
      createApprovalRequest: vi.fn().mockRejectedValue(new Error('DB down')),
    } as unknown as ApprovalWorkflowService;

    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('approval_creation_failed');
    }
  });

  it('throws gate_internal_error when require_approval has no required_chain', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      // required_chain is missing — policy bug
    } as EvaluationResult);

    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(MOVEMENT, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('gate_internal_error');
    }
  });

  it('throws enterprise_mismatch when movement metadata enterprise differs from actor', async () => {
    const movementWithMismatch: ProposedMovement = {
      ...MOVEMENT,
      metadata: { enterprise_id: 'ent-OTHER' },
    };

    const evaluate = vi.fn();
    const gate = new PolicyGateService(SUPABASE, {
      evaluate,
      approvalService: mockApprovalService(),
    });

    try {
      await gate.gate(movementWithMismatch, ACTOR);
      throw new Error('expected gate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GateError);
      expect((err as GateError).reason_code).toBe('enterprise_mismatch');
    }
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('AI-initiator regression: verdict=require_approval + agent initiator is handled normally', async () => {
    const agentMovement: ProposedMovement = {
      ...MOVEMENT,
      initiator: { type: 'agent', agent_id: 'forecaster-1' },
    };

    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(agentMovement, ACTOR);

    expect(result.verdict).toBe('require_approval');
    expect(approvalService.createApprovalRequest).toHaveBeenCalled();
  });

  it('no policy version (allow_auto) is handled as a no-op pass-through', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'allow_auto',
      trace: makeTrace({ policy_version_id: null }),
      reason_codes: [],
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('allow_auto');
    expect(approvalService.createApprovalRequest).not.toHaveBeenCalled();
  });

  it('returned approval_request.movement_id equals movement.id (identity preserved)', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      verdict: 'require_approval',
      trace: makeTrace(),
      reason_codes: [],
      required_chain: CHAIN,
    } as EvaluationResult);

    const approvalService = mockApprovalService();
    const gate = new PolicyGateService(SUPABASE, { evaluate, approvalService });

    const result = await gate.gate(MOVEMENT, ACTOR);

    expect(result.verdict).toBe('require_approval');
    if (result.verdict === 'require_approval') {
      expect(result.approval_request.movement_id).toBe('mov-1');
    }
  });
});
