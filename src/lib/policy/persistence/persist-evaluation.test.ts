// src/lib/policy/persistence/persist-evaluation.test.ts

import { describe, it, expect, vi } from 'vitest';
import { persistEvaluation, markPolicyEvaluationExecuted } from './persist-evaluation';
import type { ProposedMovement } from '../types/movement';
import type { EvaluationContext } from '../types/context';
import type { EvaluationResult } from '../types/verdict';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeMovement(): ProposedMovement {
  return {
    id: 'mov-1',
    kind: 'crypto_transfer',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xa' },
    destination: { venue: 'solana', asset: 'USDC', address: 'Sol1' },
    amount: { amount: '10000', asset: 'USDC' },
    initiator: { type: 'human', user_id: 'u1' },
    requested_at: new Date().toISOString(),
    metadata: { enterprise_id: 'e1' },
  };
}

function makeCtx(versionId = 'ver-1'): EvaluationContext {
  return {
    policy_version: {
      id: versionId,
      enterprise_id: 'e1',
      version_number: 1,
      status: 'active',
      name: 'active',
      rules: [],
      hard_limits: [],
      approval_chains: [],
    },
    canonicalization: {
      native_amount: '10000',
      native_asset: 'USDC',
      canonical_amount: '10000',
      canonical_currency: 'USD',
      rate: '1',
      rate_source: 'coingecko',
      rate_as_of: new Date(),
      max_age_ms: 30_000,
    },
  } as unknown as EvaluationContext;
}

function makeResult(): EvaluationResult {
  return {
    verdict: 'allow_auto',
    reason_codes: [],
    trace: { rules: [] },
    required_chain: undefined,
  } as unknown as EvaluationResult;
}

function makeSupabaseStub() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const fromFn = vi.fn().mockReturnValue({ insert });
  return { supabase: { from: fromFn } as unknown as SupabaseClient, insert };
}

describe('persistEvaluation', () => {
  it('inserts a row with verdict + trace + canonicalization + context_snapshot', async () => {
    const { supabase, insert } = makeSupabaseStub();
    await persistEvaluation(supabase, {
      movement: makeMovement(),
      enterpriseId: 'e1',
      ctx: makeCtx(),
      result: makeResult(),
    });
    expect(insert).toHaveBeenCalledTimes(1);
    const payload = insert.mock.calls[0][0];
    expect(payload).toMatchObject({
      enterprise_id: 'e1',
      version_id: 'ver-1',
      movement_id: 'mov-1',
      verdict: 'allow_auto',
      reason_codes: [],
    });
    expect(payload.proposed_movement).toEqual(expect.objectContaining({ id: 'mov-1' }));
    expect(payload.canonicalization.canonical_amount).toBe('10000');
    expect(payload.context_snapshot).toBeDefined();
  });

  it('skips persistence when policy is the empty sentinel (no active version)', async () => {
    const { supabase, insert } = makeSupabaseStub();
    const emptyCtx = makeCtx('00000000-0000-0000-0000-000000000000');
    await persistEvaluation(supabase, {
      movement: makeMovement(),
      enterpriseId: 'e1',
      ctx: emptyCtx,
      result: makeResult(),
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('throws when insert returns error', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'unique violation' } });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient;
    await expect(
      persistEvaluation(supabase, {
        movement: makeMovement(),
        enterpriseId: 'e1',
        ctx: makeCtx(),
        result: makeResult(),
      }),
    ).rejects.toThrow(/unique violation/);
  });
});

describe('markPolicyEvaluationExecuted', () => {
  it('UPDATEs executed_at + execution_ref scoped to movement_id AND enterprise_id', async () => {
    const eqChain = { eq: vi.fn() };
    const secondEq = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const firstEq = { eq: vi.fn().mockReturnValue(secondEq) };
    const update = vi.fn().mockReturnValue(firstEq);
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    } as unknown as SupabaseClient;

    await markPolicyEvaluationExecuted(supabase, {
      movementId: 'mov-1',
      enterpriseId: 'e1',
      executionRef: '0xdeadbeef',
    });

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.execution_ref).toBe('0xdeadbeef');
    expect(payload.executed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(firstEq.eq).toHaveBeenCalledWith('movement_id', 'mov-1');
    expect(secondEq.eq).toHaveBeenCalledWith('enterprise_id', 'e1');
    // eqChain remains unused but silences lint
    void eqChain;
  });

  it('swallows errors (non-fatal, the movement already executed)', async () => {
    const secondEq = { eq: vi.fn().mockResolvedValue({ error: { message: 'db down' } }) };
    const firstEq = { eq: vi.fn().mockReturnValue(secondEq) };
    const supabase = {
      from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(firstEq) }),
    } as unknown as SupabaseClient;

    await expect(
      markPolicyEvaluationExecuted(supabase, { movementId: 'mov-1', enterpriseId: 'e1' }),
    ).resolves.toBeUndefined();
  });
});
