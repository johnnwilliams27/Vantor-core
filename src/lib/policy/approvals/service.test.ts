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
