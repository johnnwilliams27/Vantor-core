// src/lib/scheduled-operations/regate.test.ts

import { describe, it, expect, vi } from 'vitest';
import { reGateAtExecution } from './regate';
import type { ScheduledOperation, RampParams } from '@/types/scheduled-operations';
import type { EvaluationResult } from '@/lib/policy/types/verdict';
import type { ProposedMovement } from '@/lib/policy/types/movement';

function makeRampOp(overrides: Partial<ScheduledOperation> = {}): ScheduledOperation {
  const rampParams: RampParams = {
    direction: 'offramp',
    cryptoToken: 'USDC',
    cryptoAmount: 50_000,
    fiatCurrency: 'USD',
    fiatAmount: 50_000,
    bankAccountId: 'bank-1',
  };
  return {
    id: 'sop-1',
    user_id: 'u-1',
    enterprise_id: 'e-1',
    type: 'ramp',
    status: 'pending',
    scheduled_for: new Date().toISOString(),
    params: rampParams,
    initial_quote: { fiatAmount: 50_000, exchangeRate: 1 },
    execution_quote: null,
    deviation_bps: null,
    tolerance_bps: 25,
    executed_at: null,
    expires_at: null,
    tx_hash: null,
    error_message: null,
    memo: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function mockEvaluate(result: EvaluationResult | (() => Promise<EvaluationResult>)) {
  return typeof result === 'function'
    ? (vi.fn().mockImplementation(result) as any)
    : (vi.fn().mockResolvedValue(result) as any);
}

const supabaseStub: any = { from: vi.fn() };

describe('reGateAtExecution', () => {
  it('returns ok:true on allow_auto', async () => {
    const evaluate = mockEvaluate({
      verdict: 'allow_auto',
      reason_codes: [],
      trace: {},
      required_chain: undefined,
    } as unknown as EvaluationResult);

    const outcome = await reGateAtExecution(makeRampOp(), { supabase: supabaseStub, evaluate });
    expect(outcome).toMatchObject({ ok: true });
  });

  it('returns ok:false stale_reeval on require_approval', async () => {
    const evaluate = mockEvaluate({
      verdict: 'require_approval',
      reason_codes: ['amount_threshold_exceeded'],
      trace: {},
      required_chain: { chain_id: 'c1', slots: [] },
    } as unknown as EvaluationResult);

    const outcome = await reGateAtExecution(makeRampOp(), { supabase: supabaseStub, evaluate });
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'stale_reeval',
      details: expect.objectContaining({ chain_id: 'c1' }),
    });
  });

  it('returns ok:false policy_blocked_at_execution on block', async () => {
    const evaluate = mockEvaluate({
      verdict: 'block',
      reason_codes: ['sanctions_hit'],
      trace: {},
      required_chain: undefined,
    } as unknown as EvaluationResult);

    const outcome = await reGateAtExecution(makeRampOp(), { supabase: supabaseStub, evaluate });
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'policy_blocked_at_execution',
      details: expect.objectContaining({ verdict: 'block', reason_codes: ['sanctions_hit'] }),
    });
  });

  it('returns ok:false policy_blocked_at_execution on block_hard_limit', async () => {
    const evaluate = mockEvaluate({
      verdict: 'block_hard_limit',
      reason_codes: ['hard_limit_cap'],
      trace: {},
      required_chain: undefined,
    } as unknown as EvaluationResult);

    const outcome = await reGateAtExecution(makeRampOp(), { supabase: supabaseStub, evaluate });
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'policy_blocked_at_execution',
    });
  });

  it('returns ok:false engine_error when evaluate throws', async () => {
    const evaluate = mockEvaluate(async () => {
      throw new Error('rate feed down');
    });

    const outcome = await reGateAtExecution(makeRampOp(), { supabase: supabaseStub, evaluate });
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'engine_error',
      details: expect.objectContaining({ error: 'rate feed down' }),
    });
  });

  it('fails closed when the op has no enterprise_id', async () => {
    const evaluate = mockEvaluate({
      verdict: 'allow_auto',
      reason_codes: [],
      trace: {},
      required_chain: undefined,
    } as unknown as EvaluationResult);

    const outcome = await reGateAtExecution(
      makeRampOp({ enterprise_id: null }),
      { supabase: supabaseStub, evaluate },
    );
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'engine_error',
    });
    // evaluate should not have been called — we fail closed before engine
    expect((evaluate as any)).not.toHaveBeenCalled();
  });

  it('passes the scheduled movement to the evaluator (initiator=schedule, id=op.id)', async () => {
    const evaluate = mockEvaluate({
      verdict: 'allow_auto',
      reason_codes: [],
      trace: {},
      required_chain: undefined,
    } as unknown as EvaluationResult);

    await reGateAtExecution(makeRampOp(), { supabase: supabaseStub, evaluate });
    expect(evaluate).toHaveBeenCalledTimes(1);
    const movementArg = (evaluate as any).mock.calls[0][0] as ProposedMovement;
    expect(movementArg.id).toBe('sop-1'); // movement.id === scheduled_op.id
    expect(movementArg.initiator).toEqual({ type: 'schedule', scheduled_op_id: 'sop-1' });
    expect(movementArg.metadata).toMatchObject({
      enterprise_id: 'e-1',
      scheduled_op_id: 'sop-1',
      scheduled_op_type: 'ramp',
    });
  });
});
