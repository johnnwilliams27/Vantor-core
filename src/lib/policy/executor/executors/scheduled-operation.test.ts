// src/lib/policy/executor/executors/scheduled-operation.test.ts

import { describe, it, expect, vi } from 'vitest';
import { scheduledOperationExecutor } from './scheduled-operation';
import type { ProposedMovement } from '../../types/movement';
import type { ApprovalRequest } from '../../approvals/types';
import type { SupabaseLike } from '../types';

function makeMovement(): ProposedMovement {
  return {
    id: 'sop-1',
    kind: 'fiat_ramp',
    source: { venue: 'bank', asset: 'USD', account_id: 'bank-1' },
    destination: { venue: 'ethereum', asset: 'USDC', address: '0xw' },
    amount: { amount: '1000', asset: 'USDC' },
    initiator: { type: 'schedule', scheduled_op_id: 'sop-1' },
    requested_at: new Date().toISOString(),
    metadata: { enterprise_id: 'e1', scheduled_op_id: 'sop-1' },
  };
}

function makeRequest(): ApprovalRequest {
  return {
    id: 'req-1',
    enterprise_id: 'e1',
    version_id: 'v1',
    movement_id: 'sop-1',
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

function makeSupabaseStub(row: Record<string, unknown> | null) {
  const updateEq = {
    eq: vi.fn().mockImplementation(() => updateEq),
  };
  const update = vi.fn().mockReturnValue(updateEq);
  const selectChain = {
    eq: vi.fn().mockImplementation(() => selectChain),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  const select = vi.fn().mockReturnValue(selectChain);
  return {
    supabase: { from: vi.fn().mockReturnValue({ select, update }) } as SupabaseLike,
    update,
    updateEq,
  };
}

describe('scheduledOperationExecutor.execute', () => {
  it('flips awaiting_approval → pending so cron picks it up', async () => {
    const { supabase, update, updateEq } = makeSupabaseStub({ id: 'sop-1', status: 'awaiting_approval', scheduled_for: '2026-04-15T00:00:00Z', type: 'ramp' });
    const result = await scheduledOperationExecutor.execute(makeMovement(), makeRequest(), { supabase });
    expect(result.status).toBe('pending');
    expect(update).toHaveBeenCalledWith({ status: 'pending' });
    expect(updateEq.eq).toHaveBeenCalledWith('id', 'sop-1');
    expect(updateEq.eq).toHaveBeenCalledWith('enterprise_id', 'e1');
  });

  it('idempotent — already-terminal row returns without updating', async () => {
    const { supabase, update } = makeSupabaseStub({ id: 'sop-1', status: 'completed' });
    const result = await scheduledOperationExecutor.execute(makeMovement(), makeRequest(), { supabase });
    expect(result.status).toBe('completed');
    expect(result.notes).toMatchObject({ idempotent: true, prior_status: 'completed' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns failed if the row is missing', async () => {
    const { supabase } = makeSupabaseStub(null);
    const result = await scheduledOperationExecutor.execute(makeMovement(), makeRequest(), { supabase });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/not found/);
  });
});

describe('scheduledOperationExecutor.deny', () => {
  it('flips status to denied with the given reason', async () => {
    const { supabase, update } = makeSupabaseStub({ id: 'sop-1', status: 'awaiting_approval' });
    await scheduledOperationExecutor.deny(makeMovement(), makeRequest(), 'stale_reeval', { supabase });
    expect(update).toHaveBeenCalledWith({ status: 'denied', denial_reason: 'stale_reeval' });
  });

  it('is idempotent — terminal rows are not touched', async () => {
    const { supabase, update } = makeSupabaseStub({ id: 'sop-1', status: 'denied' });
    await scheduledOperationExecutor.deny(makeMovement(), makeRequest(), 'manual', { supabase });
    expect(update).not.toHaveBeenCalled();
  });
});
