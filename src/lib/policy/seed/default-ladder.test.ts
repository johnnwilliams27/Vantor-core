import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seedDefaultApprovalLadder } from './default-ladder';

/**
 * In-memory Supabase fake just rich enough to exercise the seed
 * function's happy path, idempotent skip, and version numbering.
 */

type Row = Record<string, unknown>;

function buildFake() {
  const tables: Record<string, Row[]> = {
    enterprise_rbac_settings: [],
    policy_policies: [],
    policy_versions: [],
    policy_approval_chains: [],
    policy_rules: [],
  };

  function getTable(name: string): Row[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function genId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function qb(tableName: string, rows: Row[]) {
    let filtered = [...rows];
    let orderCol: string | null = null;
    let orderDesc = false;
    let limitN: number | null = null;

    const api: Record<string, unknown> = {};

    api.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return api;
    };
    api.order = (col: string, opts?: { ascending?: boolean }) => {
      orderCol = col;
      orderDesc = opts?.ascending === false;
      return api;
    };
    api.limit = (n: number) => {
      limitN = n;
      return api;
    };
    api.select = (_cols?: string) => api;

    api.single = async () => {
      const data = filtered[0] ?? null;
      return { data, error: data ? null : { message: 'not found' } };
    };
    api.maybeSingle = async () => ({ data: filtered[0] ?? null, error: null });

    api.then = (resolve: (v: unknown) => unknown) => {
      let result = filtered;
      if (orderCol) {
        const col = orderCol;
        result = [...result].sort((a, b) => {
          const av = a[col] as number;
          const bv = b[col] as number;
          return orderDesc ? bv - av : av - bv;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);
      return Promise.resolve({ data: result, error: null }).then(resolve);
    };

    api.insert = (data: Row) => {
      const row = Array.isArray(data) ? data[0] : data;
      const idField = tableName === 'enterprise_rbac_settings' ? 'enterprise_id' : 'id';
      const newRow: Row = idField === 'id' && !row.id ? { id: genId(tableName), ...row } : { ...row };
      getTable(tableName).push(newRow);
      const chain: Record<string, unknown> = {
        select: () => chain,
        single: async () => ({ data: newRow, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: newRow, error: null }).then(resolve),
      };
      return chain;
    };

    api.upsert = (data: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      const row = Array.isArray(data) ? data[0] : data;
      const key = opts?.onConflict ?? 'id';
      const existing = getTable(tableName).find((r) => r[key] === row[key]);
      if (existing) {
        if (opts?.ignoreDuplicates) {
          // no-op
        } else {
          Object.assign(existing, row);
        }
        return Promise.resolve({ error: null });
      }
      getTable(tableName).push({ ...row });
      return Promise.resolve({ error: null });
    };

    return api;
  }

  const fake = {
    from: (table: string) => qb(table, getTable(table)),
  } as unknown as SupabaseClient;

  return { fake, tables };
}

describe('seedDefaultApprovalLadder', () => {
  it('creates a new active policy version with 3 chains + 3 rules on a fresh enterprise', async () => {
    const { fake, tables } = buildFake();
    const result = await seedDefaultApprovalLadder('ent-new', 'user-admin', fake);

    expect(result.policySkipped).toBe(false);
    expect(result.policyVersionId).toBeTruthy();
    expect(result.rbacSettingsEnsured).toBe(true);

    expect(tables.policy_versions).toHaveLength(1);
    expect(tables.policy_versions[0].status).toBe('active');
    expect(tables.policy_versions[0].version_number).toBe(1);

    expect(tables.policy_approval_chains).toHaveLength(3);
    expect(tables.policy_rules).toHaveLength(3);

    // Verify the $1M rule routes to the executive_dual chain
    const rule1M = tables.policy_rules.find((r) =>
      (r.name as string).includes('over $1M'),
    );
    const execChain = tables.policy_approval_chains.find((c) => c.name === 'Executive Approval');
    expect(rule1M?.verdict_chain_id).toBe(execChain?.id);

    // Verify policy_policies pointer was set
    expect(tables.policy_policies).toHaveLength(1);
    expect(tables.policy_policies[0].active_version_id).toBe(result.policyVersionId);

    // Verify rbac settings row was created with default
    expect(tables.enterprise_rbac_settings).toHaveLength(1);
    expect(tables.enterprise_rbac_settings[0].author_approver_separation_enabled).toBe(true);
  });

  it('is idempotent — skips re-seeding when an active version exists', async () => {
    const { fake, tables } = buildFake();
    // Pre-populate an active version + pointer
    tables.policy_versions.push({ id: 'ver-existing', enterprise_id: 'ent-existing', status: 'active' });
    tables.policy_policies.push({ enterprise_id: 'ent-existing', active_version_id: 'ver-existing' });

    const result = await seedDefaultApprovalLadder('ent-existing', 'user-admin', fake);

    expect(result.policySkipped).toBe(true);
    expect(result.policyVersionId).toBeUndefined();
    // No new chains or rules created
    expect(tables.policy_approval_chains).toHaveLength(0);
    expect(tables.policy_rules).toHaveLength(0);
    // But rbac settings row IS ensured
    expect(tables.enterprise_rbac_settings).toHaveLength(1);
  });

  it('increments version_number when prior (non-active) versions exist', async () => {
    const { fake, tables } = buildFake();
    // An old draft that was never activated — active_version_id is null
    tables.policy_versions.push({
      id: 'ver-old',
      enterprise_id: 'ent-mixed',
      version_number: 5,
      status: 'draft',
    });

    const result = await seedDefaultApprovalLadder('ent-mixed', 'user-admin', fake);

    expect(result.policySkipped).toBe(false);
    const newVersion = tables.policy_versions.find((v) => v.id === result.policyVersionId);
    expect(newVersion?.version_number).toBe(6);
  });
});
