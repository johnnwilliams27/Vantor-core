// src/lib/policy/executor/registry.test.ts

import { describe, it, expect, vi } from 'vitest';
import { resolveExecutor, dispatchExecute, dispatchDeny, defaultExecutorRegistry } from './registry';
import type { ProposedMovement } from '../types/movement';
import type { ApprovalRequest } from '../approvals/types';
import type { Executor, SupabaseLike } from './types';

function makeMovement(overrides: Partial<ProposedMovement> = {}): ProposedMovement {
  return {
    id: 'mov-1',
    kind: 'yield_deposit',
    source: { venue: 'ethereum', asset: 'USDC', address: '0xw' },
    destination: { venue: 'aave_v3', asset: 'USDC', label: 'aave_v3' },
    amount: { amount: '1000', asset: 'USDC' },
    initiator: { type: 'human', user_id: 'u1' },
    requested_at: new Date().toISOString(),
    metadata: { enterprise_id: 'e1' },
    ...overrides,
  };
}

function makeRequest(): ApprovalRequest {
  return {
    id: 'req-1',
    enterprise_id: 'e1',
    version_id: 'v1',
    movement_id: 'mov-1',
    proposed_movement: makeMovement(),
    triggered_rule_ids: [],
    chain_id: 'c1',
    slot_assignments: [],
    status: 'executed',
    expires_at: new Date(Date.now() + 1e7).toISOString(),
    created_at: new Date().toISOString(),
    version: 1,
  };
}

describe('resolveExecutor', () => {
  it('picks the per-kind executor for human-initiated movements', () => {
    const m = makeMovement({ kind: 'yield_deposit', initiator: { type: 'human', user_id: 'u1' } });
    const exec = resolveExecutor(m);
    expect(exec).toBe(defaultExecutorRegistry.yield_deposit);
  });

  it('picks the scheduled executor when initiator is schedule, regardless of kind', () => {
    const m = makeMovement({ kind: 'fiat_ramp', initiator: { type: 'schedule', scheduled_op_id: 'sop-1' } });
    const exec = resolveExecutor(m);
    // scheduledOperationExecutor is not in defaultExecutorRegistry keyed by
    // kind — it's resolved specially. The returned executor should not be
    // the fiat_ramp one.
    expect(exec).not.toBe(defaultExecutorRegistry.fiat_ramp);
  });

  it('accepts a custom registry override', () => {
    const fakeExecutor: Executor = {
      execute: vi.fn().mockResolvedValue({ status: 'completed', notes: {} }),
      deny: vi.fn().mockResolvedValue(undefined),
    };
    const custom = { ...defaultExecutorRegistry, yield_deposit: fakeExecutor };
    const m = makeMovement();
    expect(resolveExecutor(m, custom)).toBe(fakeExecutor);
  });
});

describe('dispatchExecute / dispatchDeny', () => {
  it('dispatches execute to the resolved executor', async () => {
    const execFn = vi.fn().mockResolvedValue({ status: 'completed', notes: { ok: true } });
    const fakeExecutor: Executor = { execute: execFn, deny: vi.fn() };
    const registry = { ...defaultExecutorRegistry, yield_deposit: fakeExecutor };
    const supabase = { from: vi.fn() } as SupabaseLike;

    const result = await dispatchExecute(makeMovement(), makeRequest(), supabase, registry);

    expect(execFn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'completed', notes: { ok: true } });
  });

  it('dispatches deny to the resolved executor with the given reason', async () => {
    const denyFn = vi.fn().mockResolvedValue(undefined);
    const fakeExecutor: Executor = { execute: vi.fn(), deny: denyFn };
    const registry = { ...defaultExecutorRegistry, yield_deposit: fakeExecutor };
    const supabase = { from: vi.fn() } as SupabaseLike;

    await dispatchDeny(makeMovement(), makeRequest(), 'stale_reeval', supabase, registry);

    expect(denyFn).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      'stale_reeval',
      { supabase },
    );
  });
});

describe('disabled-kind executors', () => {
  it('swap/bridge/payment executors return failed on execute', async () => {
    for (const kind of ['swap', 'bridge', 'payment'] as const) {
      const m = makeMovement({ kind });
      const result = await defaultExecutorRegistry[kind].execute(m, makeRequest(), { supabase: { from: vi.fn() } as SupabaseLike });
      expect(result.status).toBe('failed');
      expect(result.notes).toMatchObject({ disabled: true, kind });
    }
  });

  it('swap/bridge/payment executors no-op on deny', async () => {
    for (const kind of ['swap', 'bridge', 'payment'] as const) {
      const m = makeMovement({ kind });
      await expect(
        defaultExecutorRegistry[kind].deny(m, makeRequest(), 'manual', { supabase: { from: vi.fn() } as SupabaseLike }),
      ).resolves.toBeUndefined();
    }
  });
});

describe('crypto_transfer executor', () => {
  it('execute is a no-op returning not_applicable', async () => {
    const result = await defaultExecutorRegistry.crypto_transfer.execute(
      makeMovement({ kind: 'crypto_transfer' }),
      makeRequest(),
      { supabase: { from: vi.fn() } as SupabaseLike },
    );
    expect(result.status).toBe('not_applicable');
  });
});
