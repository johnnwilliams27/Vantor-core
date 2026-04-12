// src/lib/policy/approvals/integration.test.ts
//
// Integration smoke test: create request -> fill slot 1 -> fill slot 2 ->
// verify status=approved -> re-eval returns executed.

import { describe, it, expect } from 'vitest';
import { ApprovalWorkflowService } from './service';
import type { CreateApprovalInput, ApprovalActor } from './types';
import type { ProposedMovement } from '../types/movement';
import type { ResolvedApprovalChain, EvaluationResult } from '../types/verdict';

// ─── InMemorySupabase (same pattern as authoring/integration.test.ts) ──

type Row = Record<string, unknown>;

class QueryBuilder {
  private rows: Row[];
  private filters: Array<{ col: string; val: unknown; mode: 'eq' | 'in' }> = [];

  constructor(
    private readonly tableName: string,
    private readonly store: Record<string, Row[]>,
  ) {
    this.rows = store[tableName] ?? [];
    if (!store[tableName]) {
      store[tableName] = [];
      this.rows = store[tableName];
    }
  }

  private applyFilters(): Row[] {
    return this.rows.filter((row) =>
      this.filters.every((f) => {
        if (f.mode === 'in') return (f.val as unknown[]).includes(row[f.col]);
        return row[f.col] === f.val;
      }),
    );
  }

  select(_cols?: string): this { return this; }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val, mode: 'eq' });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    this.filters.push({ col, val: vals, mode: 'in' });
    return this;
  }

  order(_col: string, _opts?: unknown): this { return this; }
  limit(_n: number): this { return this; }

  async single(): Promise<{ data: Row | null; error: { message: string } | null }> {
    const filtered = this.applyFilters();
    const data = filtered[0] ?? null;
    return { data, error: data ? null : { message: 'Not found' } };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const filtered = this.applyFilters();
    return { data: filtered[0] ?? null, error: null };
  }

  then(resolve: (v: unknown) => unknown) {
    const filtered = this.applyFilters();
    return Promise.resolve({ data: filtered, error: null }).then(resolve);
  }

  insert(data: unknown) {
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    const withId = { id: `gen-${Math.random().toString(36).slice(2, 10)}`, ...row };
    this.rows.push(withId);
    return Promise.resolve({ data: withId, error: null });
  }

  upsert(data: unknown) {
    const incoming = (Array.isArray(data) ? data[0] : data) as Row;
    if (incoming.id) {
      const idx = this.rows.findIndex((r) => r.id === incoming.id);
      if (idx >= 0) {
        this.rows[idx] = { ...this.rows[idx], ...incoming };
        return Promise.resolve({ data: this.rows[idx], error: null });
      }
    }
    const withId = { id: `gen-${Math.random().toString(36).slice(2, 10)}`, ...incoming };
    this.rows.push(withId);
    return Promise.resolve({ data: withId, error: null });
  }

  // Version-predicate update matching the production pattern.
  update(payload: Row) {
    const rows = this.rows;
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
    updateQB.select = () => ({
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve),
    });
    updateQB.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve);
    return updateQB;
  }
}

class InMemorySupabase {
  private store: Record<string, Row[]> = {};

  constructor(fixtures?: Record<string, Row[]>) {
    if (fixtures) {
      this.store = { ...fixtures };
    }
  }

  from(table: string) {
    return new QueryBuilder(table, this.store);
  }

  getRows(table: string): Row[] {
    return this.store[table] ?? [];
  }
}

// ─── Test ──────────────────────────────────────────────────────────────

describe('Approval workflow integration', () => {
  it('create -> fill slot 1 -> fill slot 2 -> re-eval -> executed', async () => {
    // Setup in-memory Supabase with rule fixtures
    const supabase = new InMemorySupabase({
      policy_approval_requests: [],
      policy_rules: [
        { id: 'rule-1', created_by: 'user-policy-admin' },
        { id: 'rule-2', created_by: 'user-policy-admin' },
      ],
    });

    // Mock evaluate: returns require_approval with same chain
    const mockEvaluate = async (): Promise<EvaluationResult> => ({
      verdict: 'require_approval',
      trace: {} as any,
      reason_codes: [],
      required_chain: {
        chain_id: 'chain-dual',
        chain_name: 'Dual Approval',
        slots: [
          { slot_index: 0, minimum_role: 'treasury_manager' },
          { slot_index: 1, minimum_role: 'treasury_manager' },
        ],
        expiration_hours: 24,
      },
    });

    const svc = new ApprovalWorkflowService(supabase as any, {
      evaluate: mockEvaluate,
    });

    const movement: ProposedMovement = {
      id: 'mov-integration',
      kind: 'crypto_transfer',
      source: { venue: 'ethereum', asset: 'USDC' },
      destination: { venue: 'ethereum', asset: 'USDC', address: '0xabc' },
      amount: { value: '50000', currency: 'USD' },
      initiator: { type: 'human', user_id: 'user-initiator' },
      requested_at: '2026-04-12T10:00:00Z',
    };

    const chain: ResolvedApprovalChain = {
      chain_id: 'chain-dual',
      chain_name: 'Dual Approval',
      slots: [
        { slot_index: 0, minimum_role: 'treasury_manager' },
        { slot_index: 1, minimum_role: 'treasury_manager' },
      ],
      expiration_hours: 24,
    };

    // Step 1: Create approval request
    const input: CreateApprovalInput = {
      enterprise_id: 'ent-int',
      version_id: 'ver-int',
      movement_id: 'mov-integration',
      proposed_movement: movement,
      chain,
      triggered_rule_ids: ['rule-1', 'rule-2'],
      created_by: 'user-initiator',
    };

    const created = await svc.createApprovalRequest(input);
    expect(created.status).toBe('pending');
    expect(created.slot_assignments).toHaveLength(2);
    expect(created.slot_assignments[0].filled_by).toBeUndefined();
    expect(created.slot_assignments[1].filled_by).toBeUndefined();

    // Step 2: Approver 1 fills slot 0
    const approver1: ApprovalActor = {
      user_id: 'user-approver-1',
      role: 'treasury_manager',
      enterprise_id: 'ent-int',
    };

    const afterSlot1 = await svc.fillSlot(approver1, created.id, 'Reviewed and approved');
    expect(afterSlot1.status).toBe('pending');
    expect(afterSlot1.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(afterSlot1.slot_assignments[1].filled_by).toBeUndefined();

    // Step 3: Approver 2 fills slot 1 (all slots filled => approved => re-eval)
    const approver2: ApprovalActor = {
      user_id: 'user-approver-2',
      role: 'treasury_manager',
      enterprise_id: 'ent-int',
    };

    const final = await svc.fillSlot(approver2, created.id, 'LGTM');

    // Re-eval returns require_approval with same chain => executed
    expect(final.status).toBe('executed');
    expect(final.slot_assignments[0].filled_by).toBe('user-approver-1');
    expect(final.slot_assignments[1].filled_by).toBe('user-approver-2');
    expect(final.resolved_at).toBeDefined();
  });
});
