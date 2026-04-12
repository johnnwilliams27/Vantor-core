/**
 * integration.test.ts — End-to-end smoke test for PolicyAuthoringService
 *
 * Exercises the full authoring flow against an in-memory Supabase mock:
 * createDraft → upsertRule → upsertApprovalChain → upsertHardLimit →
 * getVersionById → upsertRule (update) → listVersions
 */

import { describe, it, expect } from 'vitest';
import { PolicyAuthoringService } from './service';
import { AuthoringActor } from './types';

// ─── InMemorySupabase ────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

class QueryBuilder {
  private rows: Row[];
  private filters: Array<{ col: string; val: unknown }> = [];

  constructor(
    private readonly tableName: string,
    private readonly store: Record<string, Row[]>,
  ) {
    this.rows = store[tableName] ?? [];
    // Ensure the table exists in the store
    if (!store[tableName]) {
      store[tableName] = [];
      this.rows = store[tableName];
    }
  }

  private applyFilters(): Row[] {
    return this.rows.filter((row) =>
      this.filters.every((f) => row[f.col] === f.val),
    );
  }

  select(_cols?: string): this {
    return this;
  }

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }

  in(col: string, vals: unknown[]): this {
    // Filter to rows where column value is in the vals array
    // We do this by adding a special sentinel filter
    this.filters.push({ col: `__in__${col}`, val: vals });
    return this;
  }

  order(_col: string, _opts?: { ascending?: boolean }): this {
    return this;
  }

  limit(_n: number): this {
    return this;
  }

  async single(): Promise<{ data: Row | null; error: null }> {
    const results = this.applyFilters();
    return { data: results[0] ?? null, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const results = this.applyFilters();
    return { data: results[0] ?? null, error: null };
  }

  // Thenability — allows `await builder.eq(...)` to resolve to array result
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const results = this.applyFilters();
    return Promise.resolve({ data: results, error: null as null }).then(
      onfulfilled as (value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>,
      onrejected,
    );
  }

  insert(data: Row | Row[]): Promise<{ data: Row | null; error: null }> {
    const rows = this.store[this.tableName];
    const row = Array.isArray(data) ? data[0] : data;
    const withId: Row = {
      id: `gen-${Math.random().toString(36).slice(2, 10)}`,
      created_at: new Date().toISOString(),
      ...row,
    };
    rows.push(withId);
    return Promise.resolve({ data: withId, error: null });
  }

  upsert(data: Row | Row[], _opts?: { onConflict?: string }): Promise<{ data: Row | null; error: null }> {
    const rows = this.store[this.tableName];
    const row = Array.isArray(data) ? data[0] : data;
    const incoming = row as Row;

    if (incoming.id) {
      const idx = rows.findIndex((r) => r.id === incoming.id);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], ...incoming };
        return Promise.resolve({ data: rows[idx], error: null });
      }
    }

    const withId: Row = {
      id: `gen-${Math.random().toString(36).slice(2, 10)}`,
      created_at: new Date().toISOString(),
      ...incoming,
    };
    rows.push(withId);
    return Promise.resolve({ data: withId, error: null });
  }

  delete(): DeleteBuilder {
    return new DeleteBuilder(this.tableName, this.store);
  }
}

// DeleteBuilder handles the `.delete().eq(col, val).eq(col, val)` pattern
class DeleteBuilder {
  private filters: Array<{ col: string; val: unknown }> = [];

  constructor(
    private readonly tableName: string,
    private readonly store: Record<string, Row[]>,
  ) {}

  eq(col: string, val: unknown): this {
    this.filters.push({ col, val });
    return this;
  }

  then<TResult1 = { data: null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.store[this.tableName];
    const idx = rows.findIndex((r) =>
      this.filters.every((f) => r[f.col] === f.val),
    );
    if (idx >= 0) rows.splice(idx, 1);
    return Promise.resolve({ data: null as null, error: null as null }).then(
      onfulfilled as (value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>,
      onrejected,
    );
  }
}

class InMemorySupabase {
  private store: Record<string, Row[]>;

  constructor(seed: Record<string, Row[]> = {}) {
    this.store = seed;
  }

  from(table: string): QueryBuilder {
    if (!this.store[table]) {
      this.store[table] = [];
    }
    return new QueryBuilder(table, this.store);
  }
}

// ─── Test actors ─────────────────────────────────────────────────────────────

const ENTERPRISE_ID = 'ent-1';

const adminActor: AuthoringActor = {
  user_id: 'user-admin',
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

// ─── Integration smoke test ───────────────────────────────────────────────────

describe('PolicyAuthoringService — end-to-end integration smoke test', () => {
  it('exercises the full authoring flow', async () => {
    // 1. Build in-memory Supabase, pre-populated with user_profiles
    const db = new InMemorySupabase({
      user_profiles: [
        {
          id: 'user-admin',
          enterprise_id: ENTERPRISE_ID,
          role: 'treasury_manager',
          is_policy_admin: true,
          is_app_admin: false,
        },
        {
          id: 'user-2',
          enterprise_id: ENTERPRISE_ID,
          role: 'treasury_manager',
          is_policy_admin: false,
          is_app_admin: false,
        },
      ],
      policy_versions: [],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });

    const service = new PolicyAuthoringService(db);

    // 2. Create a draft version
    const draft = await service.createDraft(adminActor, { name: 'Integration Draft v1' });
    expect(draft).toBeDefined();
    expect(draft.id).toBeTruthy();
    expect(draft.status).toBe('draft');
    expect(draft.enterprise_id).toBe(ENTERPRISE_ID);
    expect(draft.name).toBe('Integration Draft v1');
    expect(draft.version_number).toBe(1);

    const versionId = draft.id;

    // 3. Add a rule (use 'allow' verdict so no chain reference is required yet)
    const afterRule = await service.upsertRule(adminActor, versionId, {
      rule_type: 'approval_threshold',
      name: 'Large Transfer Rule',
      rationale: 'Transfers over $50k require approval',
      condition: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '>',
        value: { amount: '50000', currency: 'USD' },
      },
      verdict: 'allow',
      priority: 10,
    });
    expect(afterRule.rules).toHaveLength(1);
    expect(afterRule.rules[0].name).toBe('Large Transfer Rule');
    expect(afterRule.rules[0].priority).toBe(10);

    const ruleId = afterRule.rules[0].id;

    // 4. Add an approval chain
    const afterChain = await service.upsertApprovalChain(adminActor, versionId, {
      name: 'CFO Approval Chain',
      slots: [{ slot_index: 0, minimum_role: 'treasury_manager', label: 'CFO' }],
      priority: 1,
      expiration_hours: 48,
    });
    expect(afterChain.approval_chains).toHaveLength(1);
    expect(afterChain.approval_chains[0].name).toBe('CFO Approval Chain');
    expect(afterChain.approval_chains[0].expiration_hours).toBe(48);

    // 5. Add a hard limit (requires is_policy_admin)
    const afterLimit = await service.upsertHardLimit(adminActor, versionId, {
      limit_type: 'max_daily_outflow_usd',
      name: 'Daily Outflow Cap',
      limit_value: '500000',
      limit_currency: 'USD',
      scope: {},
    });
    expect(afterLimit.hard_limits).toHaveLength(1);
    expect(afterLimit.hard_limits[0].name).toBe('Daily Outflow Cap');
    expect(afterLimit.hard_limits[0].limit_value).toBe('500000');

    // 6. Load the version back with all children via getVersionById
    const loaded = await service.getVersionById(adminActor, versionId);
    expect(loaded.id).toBe(versionId);
    expect(loaded.status).toBe('draft');
    expect(loaded.rules).toHaveLength(1);
    expect(loaded.approval_chains).toHaveLength(1);
    expect(loaded.hard_limits).toHaveLength(1);
    // Verify child associations
    expect(loaded.rules[0].version_id).toBe(versionId);
    expect(loaded.approval_chains[0].version_id).toBe(versionId);

    // 7. Edit the rule — update priority
    const afterEdit = await service.upsertRule(adminActor, versionId, {
      id: ruleId,
      rule_type: 'approval_threshold',
      name: 'Large Transfer Rule',
      rationale: 'Transfers over $50k require approval',
      condition: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '>',
        value: { amount: '50000', currency: 'USD' },
      },
      verdict: 'allow',
      priority: 20, // updated
    });
    expect(afterEdit.rules).toHaveLength(1);
    expect(afterEdit.rules[0].id).toBe(ruleId);
    expect(afterEdit.rules[0].priority).toBe(20);

    // 8. listVersions returns the draft
    const versions = await service.listVersions(adminActor);
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(versionId);
    expect(versions[0].status).toBe('draft');
  });
});
