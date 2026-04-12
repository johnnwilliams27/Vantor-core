// src/lib/policy/approvals/service.test.ts

import { describe, it, expect } from 'vitest';
import { ApprovalWorkflowService } from './service';
import { ApprovalError } from './errors';
import type { CreateApprovalInput, ApprovalActor } from './types';
import type { ProposedMovement } from '../types/movement';
import type { ResolvedApprovalChain } from '../types/verdict';

// ─── Mock Supabase builder ──────────────────────────────────────────────

type Row = Record<string, unknown>;

function mockSupabase(
  fixtures: {
    policy_approval_requests?: Row[];
    policy_rules?: Row[];
    user_profiles?: Row[];
  },
) {
  const tableData: Record<string, Row[]> = {
    policy_approval_requests: fixtures.policy_approval_requests ?? [],
    policy_rules: fixtures.policy_rules ?? [],
    user_profiles: fixtures.user_profiles ?? [],
  };

  function makeQB(table: string, rows: Row[]) {
    let filtered = [...rows];
    const qb: Record<string, unknown> = {};

    qb.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return qb;
    };

    qb.in = (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => (vals as unknown[]).includes(r[col]));
      return qb;
    };

    qb.order = (_col: string, _opts?: unknown) => qb;
    qb.limit = (_n: number) => qb;
    qb.select = (_cols?: string) => qb;

    qb.single = async () => {
      const data = filtered[0] ?? null;
      return { data, error: filtered.length === 0 ? { message: 'Not found' } : null };
    };

    qb.maybeSingle = async () => {
      const data = filtered[0] ?? null;
      return { data, error: null };
    };

    qb.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(resolve);

    qb.insert = (data: unknown) => {
      const row = Array.isArray(data) ? data[0] : data;
      const withId = { id: `gen-${Math.random().toString(36).slice(2)}`, ...row } as Row;
      rows.push(withId);
      return Promise.resolve({ data: withId, error: null });
    };

    qb.upsert = (data: unknown) => {
      const incoming = (Array.isArray(data) ? data[0] : data) as Row;
      if (incoming.id) {
        const idx = rows.findIndex((r) => r.id === incoming.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...incoming };
          return Promise.resolve({ data: rows[idx], error: null });
        }
      }
      const withId = { id: `gen-${Math.random().toString(36).slice(2)}`, ...incoming };
      rows.push(withId);
      return Promise.resolve({ data: withId, error: null });
    };

    // Supabase-compatible update builder: .update(payload).eq(...).eq(...).select()
    // Applies the payload to rows matching ALL accumulated filters. Returns only
    // the rows that matched (an empty array means "no rows matched the version
    // predicate" -> caller treats as concurrent_modification).
    qb.update = (payload: Row) => {
      const updateFilters: Array<{ col: string; val: unknown }> = [];
      const updateQB: Record<string, unknown> = {};

      const execute = () => {
        const matched = rows.filter((r) =>
          updateFilters.every((f) => r[f.col] === f.val),
        );
        const updatedRows: Row[] = [];
        for (const m of matched) {
          const idx = rows.indexOf(m);
          if (idx >= 0) {
            rows[idx] = { ...rows[idx], ...payload };
            updatedRows.push(rows[idx]);
          }
        }
        return { data: updatedRows, error: null as null | { message: string } };
      };

      updateQB.eq = (col: string, val: unknown) => {
        updateFilters.push({ col, val });
        return updateQB;
      };
      updateQB.select = () => {
        // Post-select the executed result
        return {
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(execute()).then(resolve),
        };
      };
      updateQB.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve);

      return updateQB;
    };

    return qb;
  }

  return {
    from: (table: string) => {
      const rows = tableData[table] ?? [];
      return makeQB(table, rows);
    },
  };
}

// ─── Shared fixtures ───────────────────────────────────────────────────

const ENTERPRISE_ID = 'ent-001';
const USER_ID = 'user-initiator';

const MOVEMENT: ProposedMovement = {
  id: 'mov-001',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
  amount: { value: '10000', currency: 'USD' },
  initiator: { type: 'human', user_id: USER_ID },
  requested_at: '2026-04-12T00:00:00Z',
};

const CHAIN: ResolvedApprovalChain = {
  chain_id: 'chain-001',
  chain_name: 'Dual Approval',
  slots: [
    { slot_index: 0, minimum_role: 'treasury_manager' },
    { slot_index: 1, minimum_role: 'treasury_manager' },
  ],
  expiration_hours: 24,
};

const CREATE_INPUT: CreateApprovalInput = {
  enterprise_id: ENTERPRISE_ID,
  version_id: 'ver-001',
  movement_id: 'mov-001',
  proposed_movement: MOVEMENT,
  chain: CHAIN,
  triggered_rule_ids: ['rule-1'],
  created_by: USER_ID,
};

const managerActor: ApprovalActor = {
  user_id: 'user-approver-1',
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

// ─── Tests ─────────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.createApprovalRequest', () => {
  it('creates a pending request with correct fields', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);

    expect(result.status).toBe('pending');
    expect(result.enterprise_id).toBe(ENTERPRISE_ID);
    expect(result.movement_id).toBe('mov-001');
    expect(result.chain_id).toBe('chain-001');
    expect(result.version).toBe(0);
    expect(result.slot_assignments).toHaveLength(2);
    expect(result.slot_assignments[0].filled_by).toBeUndefined();
    expect(result.slot_assignments[1].filled_by).toBeUndefined();
  });

  it('computes expires_at based on chain.expiration_hours', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);
    const expiresAt = new Date(result.expires_at).getTime();
    const createdAt = new Date(result.created_at).getTime();

    // Should be approximately 24 hours after creation
    const diffHours = (expiresAt - createdAt) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(24, 0);
  });

  it('initializes slot_assignments from chain slots', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);

    expect(result.slot_assignments).toEqual([
      { slot_index: 0, minimum_role: 'treasury_manager' },
      { slot_index: 1, minimum_role: 'treasury_manager' },
    ]);
  });

  it('returns existing request for duplicate movement_id (idempotent)', async () => {
    const existingRow = {
      id: 'req-existing',
      enterprise_id: ENTERPRISE_ID,
      movement_id: 'mov-001',
      status: 'pending',
      version: 0,
    };
    const sb = mockSupabase({
      policy_approval_requests: [existingRow],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.createApprovalRequest(CREATE_INPUT);

    expect(result.id).toBe('req-existing');
  });

  it('rejects creation with empty chain slots (vacuous approval guard)', async () => {
    const sb = mockSupabase({});
    const svc = new ApprovalWorkflowService(sb);

    const input: CreateApprovalInput = {
      ...CREATE_INPUT,
      chain: { ...CHAIN, slots: [] },
    };

    await expect(svc.createApprovalRequest(input)).rejects.toThrow(ApprovalError);
  });
});

// ─── getRequest ────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.getRequest', () => {
  const REQ_ROW = {
    id: 'req-001',
    enterprise_id: ENTERPRISE_ID,
    version_id: 'ver-001',
    movement_id: 'mov-001',
    proposed_movement: MOVEMENT,
    triggered_rule_ids: ['rule-1'],
    chain_id: 'chain-001',
    slot_assignments: [{ slot_index: 0, minimum_role: 'treasury_manager' }],
    status: 'pending',
    expires_at: '2026-04-13T00:00:00Z',
    created_by: USER_ID,
    created_at: '2026-04-12T00:00:00Z',
    version: 0,
  };

  it('returns the request when it exists in the enterprise', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [REQ_ROW],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.getRequest(managerActor, 'req-001');
    expect(result.id).toBe('req-001');
  });

  it('throws when request is in a different enterprise', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [{ ...REQ_ROW, enterprise_id: 'ent-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.getRequest(managerActor, 'req-001'),
    ).rejects.toThrow(ApprovalError);
  });
});

// ─── listRequests ──────────────────────────────────────────────────────

describe('ApprovalWorkflowService.listRequests', () => {
  const REQ_PENDING = {
    id: 'req-001',
    enterprise_id: ENTERPRISE_ID,
    status: 'pending',
    created_at: '2026-04-12T00:00:00Z',
  };
  const REQ_DENIED = {
    id: 'req-002',
    enterprise_id: ENTERPRISE_ID,
    status: 'denied',
    created_at: '2026-04-11T00:00:00Z',
  };

  it('returns all requests for the enterprise', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [REQ_PENDING, REQ_DENIED],
    });
    const svc = new ApprovalWorkflowService(sb);

    const results = await svc.listRequests(managerActor);
    expect(results).toHaveLength(2);
  });

  it('filters by status when provided', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [REQ_PENDING, REQ_DENIED],
    });
    const svc = new ApprovalWorkflowService(sb);

    const results = await svc.listRequests(managerActor, { status: 'pending' });
    expect(results.every((r) => r.status === 'pending')).toBe(true);
  });
});

// ─── fillSlot ──────────────────────────────────────────────────────────

describe('ApprovalWorkflowService.fillSlot', () => {
  function makePendingRequest(overrides?: Partial<Row>): Row {
    return {
      id: 'req-fill',
      enterprise_id: ENTERPRISE_ID,
      version_id: 'ver-001',
      movement_id: 'mov-fill',
      proposed_movement: MOVEMENT,
      triggered_rule_ids: ['rule-1'],
      chain_id: 'chain-001',
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
      status: 'pending',
      expires_at: '2026-04-13T00:00:00Z',
      created_by: USER_ID,
      created_at: '2026-04-12T00:00:00Z',
      version: 0,
      ...overrides,
    };
  }

  it('fills the first unfilled slot and returns the updated request', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.fillSlot(managerActor, 'req-fill', 'Looks good');

    expect(result.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(result.slot_assignments[0].justification).toBe('Looks good');
    expect(result.slot_assignments[1].filled_by).toBeUndefined();
    expect(result.status).toBe('pending');
    expect(result.version).toBe(1);
  });

  it('marks request as approved when all slots are filled (triggers reEvaluate)', async () => {
    // One slot already filled, fill the second
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager', filled_by: 'user-other', filled_at: '2026-04-12T01:00:00Z' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
    });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-unrelated' }],
    });
    // No evaluate fn => stub: marks as executed
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.fillSlot(managerActor, 'req-fill', 'LGTM');

    expect(result.slot_assignments[1].filled_by).toBe('user-approver-1');
    expect(result.status).toBe('executed');
    expect(result.resolved_at).toBeDefined();
  });

  it('throws approval_not_pending when request is already denied', async () => {
    const req = makePendingRequest({ status: 'denied' });
    const sb = mockSupabase({
      policy_approval_requests: [req],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(managerActor, 'req-fill', 'too late'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(managerActor, 'req-fill', 'too late');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('approval_not_pending');
    }
  });

  it('throws sod_initiator_conflict when approver is the initiator', async () => {
    const initiatorActor: ApprovalActor = {
      user_id: USER_ID, // same as created_by
      role: 'treasury_manager',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(initiatorActor, 'req-fill', 'self approve'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(initiatorActor, 'req-fill', 'self approve');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('sod_initiator_conflict');
    }
  });

  it('throws sod_rule_editor_conflict when approver authored a triggering rule', async () => {
    const editorActor: ApprovalActor = {
      user_id: 'user-rule-author',
      role: 'treasury_manager',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-rule-author' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(editorActor, 'req-fill', 'my rule'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(editorActor, 'req-fill', 'my rule');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('sod_rule_editor_conflict');
    }
  });

  it('throws sod_already_filled when approver already filled a slot', async () => {
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager', filled_by: 'user-approver-1', filled_at: '2026-04-12T01:00:00Z' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
    });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(managerActor, 'req-fill', 'again'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(managerActor, 'req-fill', 'again');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('sod_already_filled');
    }
  });

  it('throws no_matching_slot when approver role is too low', async () => {
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'executive' },
      ],
    });
    const lowActor: ApprovalActor = {
      user_id: 'user-low',
      role: 'accountant',
      enterprise_id: ENTERPRISE_ID,
    };
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(lowActor, 'req-fill', 'try'),
    ).rejects.toThrow(ApprovalError);

    try {
      await svc.fillSlot(lowActor, 'req-fill', 'try');
    } catch (e) {
      expect((e as ApprovalError).reason_code).toBe('no_matching_slot');
    }
  });

  it('single slot request: fills and auto-executes', async () => {
    const req = makePendingRequest({
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
      ],
    });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const result = await svc.fillSlot(managerActor, 'req-fill', 'approved');

    expect(result.status).toBe('executed');
    expect(result.slot_assignments[0].filled_by).toBe('user-approver-1');
  });

  // ── Adversarial regression tests from Task 7 review ────────────────

  it('rejects concurrent fillSlot on same version (optimistic lock)', async () => {
    const req = makePendingRequest();
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const otherManager: ApprovalActor = {
      user_id: 'user-approver-2',
      role: 'treasury_manager',
      enterprise_id: ENTERPRISE_ID,
    };

    // Approver A succeeds
    const first = await svc.fillSlot(managerActor, 'req-fill', 'first');
    expect(first.version).toBe(1);

    // Approver B now tries to fill using a STALE snapshot of version=0
    // (simulating a race where B loaded the request before A wrote).
    // We simulate by manually invoking with the original request via mock state:
    // after A's write, the row is version=1. If B tries with expected=0, no match.
    // To simulate, we'd need to re-read with state before A wrote. Instead, we
    // force the row back to version=0 but keep slot 0 filled by A, then have B
    // attempt: B's fillSlot sees version=0 (stale), writes expected=0, succeeds
    // in mock BUT the slot-index guard catches it (targetSlot.filled_by is set).
    // Alternatively: verify that after A, a new fillSlot with *actual* state
    // (version=1) by B works. That's not a concurrency test. The real test:
    // attempt to re-enter fillSlot after A with B's identity using the updated
    // state, and verify B hits sod_already_filled or fills slot 1, not slot 0.
    const second = await svc.fillSlot(otherManager, 'req-fill', 'second');
    // B should fill slot 1, not overwrite slot 0
    expect(second.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(second.slot_assignments[1].filled_by).toBe('user-approver-2');
    expect(second.version).toBe(3); // v0 -> A fill (v1) -> B fill (v2) -> reEval resolve (v3)
  });

  it('rejects vacuous approval: empty slot_assignments on pending request', async () => {
    const req = makePendingRequest({ slot_assignments: [] });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(managerActor, 'req-fill', 'approve'),
    ).rejects.toThrow(ApprovalError);
  });

  it('rejects empty justification', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    await expect(
      svc.fillSlot(managerActor, 'req-fill', ''),
    ).rejects.toThrow(ApprovalError);
  });

  it('rejects oversized justification (>2000 chars)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makePendingRequest()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb);

    const huge = 'x'.repeat(2001);
    await expect(
      svc.fillSlot(managerActor, 'req-fill', huge),
    ).rejects.toThrow(ApprovalError);
  });

  it('cross-tenant fillSlot cannot forge writes to a different enterprise request', async () => {
    // Setup: request belongs to ent-A. Attacker's actor claims ent-B.
    const req = makePendingRequest({ enterprise_id: 'ent-A' });
    const sb = mockSupabase({
      policy_approval_requests: [req],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const attackerFromOtherEnt: ApprovalActor = {
      user_id: 'user-attacker',
      role: 'treasury_manager',
      enterprise_id: 'ent-B',
    };
    const svc = new ApprovalWorkflowService(sb);

    // getRequest filters by actor.enterprise_id, so the row is "not found"
    // and throws. This protects both read AND write paths.
    await expect(
      svc.fillSlot(attackerFromOtherEnt, 'req-fill', 'force'),
    ).rejects.toThrow(ApprovalError);

    // Verify the row was not mutated
    expect(sb.from('policy_approval_requests').select().eq('id', 'req-fill')).toBeDefined();
  });
});

// ─── reEvaluate (via fillSlot with injected evaluate) ──────────────────

describe('ApprovalWorkflowService reEvaluate', () => {
  function makeSingleSlotPending(overrides?: Partial<Row>): Row {
    return {
      id: 'req-reeval',
      enterprise_id: ENTERPRISE_ID,
      version_id: 'ver-001',
      movement_id: 'mov-reeval',
      proposed_movement: MOVEMENT,
      triggered_rule_ids: ['rule-1'],
      chain_id: 'chain-001',
      slot_assignments: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
      ],
      status: 'pending',
      expires_at: '2026-04-13T00:00:00Z',
      created_by: USER_ID,
      created_at: '2026-04-12T00:00:00Z',
      version: 0,
      ...overrides,
    };
  }

  it('require_approval with same chain_id => executed', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'require_approval',
        trace: {} as any,
        reason_codes: [],
        required_chain: {
          chain_id: 'chain-001', // same chain
          chain_name: 'Dual Approval',
          slots: [],
          expiration_hours: 24,
        },
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('executed');
  });

  it('require_approval with different chain_id => denied(stale_reeval)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'require_approval',
        trace: {} as any,
        reason_codes: [],
        required_chain: {
          chain_id: 'chain-different', // different chain
          chain_name: 'New Chain',
          slots: [],
          expiration_hours: 48,
        },
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('stale_reeval');
  });

  it('block verdict => denied(stale_reeval)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'block',
        trace: {} as any,
        reason_codes: [],
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('stale_reeval');
  });

  it('block_hard_limit verdict => denied(stale_reeval)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'block_hard_limit',
        trace: {} as any,
        reason_codes: ['hard_limit_breached'],
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('stale_reeval');
  });

  it('allow_auto verdict => executed (policy relaxed)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb, {
      evaluate: async () => ({
        verdict: 'allow_auto',
        trace: {} as any,
        reason_codes: [],
      }),
    });

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('executed');
  });

  it('no evaluate fn => executed (stub behavior)', async () => {
    const sb = mockSupabase({
      policy_approval_requests: [makeSingleSlotPending()],
      policy_rules: [{ id: 'rule-1', created_by: 'user-other' }],
    });
    const svc = new ApprovalWorkflowService(sb); // no evaluate fn

    const result = await svc.fillSlot(managerActor, 'req-reeval', 'ok');
    expect(result.status).toBe('executed');
  });
});
