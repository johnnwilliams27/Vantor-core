/**
 * service.test.ts — PolicyAuthoringService unit tests
 * Tasks 7-11: read operations, draft lifecycle, rule/limit/chain CRUD.
 */

import { describe, it, expect, vi } from 'vitest';
import { PolicyAuthoringService } from './service';
import { AuthoringActor } from './types';
import { AuthoringError } from './errors';

// ─── Mock Supabase builder ──────────────────────────────────────────────────

type WriteOp = {
  kind: 'insert' | 'upsert' | 'delete';
  table: string;
  data?: unknown;
  filter?: Record<string, unknown>;
};

function mockSupabase(fixtures: {
  policy_policies?: Array<Record<string, unknown>>;
  policy_versions?: Array<Record<string, unknown>>;
  policy_rules?: Array<Record<string, unknown>>;
  policy_hard_limits?: Array<Record<string, unknown>>;
  policy_approval_chains?: Array<Record<string, unknown>>;
  user_profiles?: Array<Record<string, unknown>>;
}) {
  const writes: WriteOp[] = [];

  function makeQB(table: string, rows: Array<Record<string, unknown>>) {
    // We track applied eq/in filters and build lazily
    let filtered = [...rows];

    const qb: Record<string, unknown> = {};

    // Chainable filter — mutates `filtered` then returns qb
    qb.eq = (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val);
      return qb;
    };

    qb.in = (col: string, vals: unknown[]) => {
      filtered = filtered.filter((r) => vals.includes(r[col]));
      return qb;
    };

    qb.order = (_col: string, _opts?: unknown) => qb;
    qb.limit = (_n: number) => qb;

    qb.select = (_cols: string) => qb;

    qb.single = async () => {
      const data = filtered[0] ?? null;
      return { data, error: null };
    };

    qb.maybeSingle = async () => {
      const data = filtered[0] ?? null;
      return { data, error: null };
    };

    // Make qb thenable so `await qb.eq(...).eq(...)` resolves to { data, error }
    qb.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: filtered, error: null }).then(resolve);

    // ── Write operations ──

    qb.insert = (data: unknown) => {
      // Resolve inserted data: if array use first item, else use object
      const row = Array.isArray(data) ? data[0] : data;
      // Generate fake id if missing
      const withId = { id: `gen-${Math.random().toString(36).slice(2)}`, ...row } as Record<string, unknown>;
      writes.push({ kind: 'insert', table, data: withId });
      // Push into fixture so follow-on reads see it
      rows.push(withId);
      return Promise.resolve({ data: withId, error: null });
    };

    qb.upsert = (data: unknown, _opts?: unknown) => {
      const row = Array.isArray(data) ? data[0] : data;
      const incoming = row as Record<string, unknown>;
      if (incoming.id) {
        const idx = rows.findIndex((r) => r.id === incoming.id);
        if (idx >= 0) {
          rows[idx] = { ...rows[idx], ...incoming };
          writes.push({ kind: 'upsert', table, data: rows[idx] });
          return Promise.resolve({ data: rows[idx], error: null });
        }
      }
      const withId = { id: `gen-${Math.random().toString(36).slice(2)}`, ...incoming } as Record<string, unknown>;
      rows.push(withId);
      writes.push({ kind: 'upsert', table, data: withId });
      return Promise.resolve({ data: withId, error: null });
    };

    qb.delete = () => {
      // Returns a fresh builder that has .eq().eq() filter to identify target
      const deleteFilters: Record<string, unknown> = {};
      const deleteQB: Record<string, unknown> = {};
      deleteQB.eq = (col: string, val: unknown) => {
        deleteFilters[col] = val;
        return deleteQB;
      };
      // Final .eq() needs to be awaitable
      const origEq = deleteQB.eq as (col: string, val: unknown) => Record<string, unknown>;
      deleteQB.eq = (col: string, val: unknown) => {
        deleteFilters[col] = val;
        const result = origEq(col, val);
        // Make the final result thenable
        result.then = (resolve: (v: unknown) => unknown) => {
          // Perform the delete
          const target = rows.findIndex((r) =>
            Object.entries(deleteFilters).every(([k, v]) => r[k] === v),
          );
          writes.push({ kind: 'delete', table, filter: { ...deleteFilters } });
          if (target >= 0) rows.splice(target, 1);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        };
        return result;
      };
      return deleteQB;
    };

    return qb;
  }

  const tableMap: Record<string, Array<Record<string, unknown>>> = {
    policy_policies: fixtures.policy_policies ?? [],
    policy_versions: fixtures.policy_versions ?? [],
    policy_rules: fixtures.policy_rules ?? [],
    policy_hard_limits: fixtures.policy_hard_limits ?? [],
    policy_approval_chains: fixtures.policy_approval_chains ?? [],
    user_profiles: fixtures.user_profiles ?? [],
  };

  const supabase = {
    from: (table: string) => {
      const rows = tableMap[table] ?? [];
      return makeQB(table, rows);
    },
    _writes: writes,
  };

  return supabase;
}

// ─── Actors & Fixtures ──────────────────────────────────────────────────────

const ENTERPRISE_ID = 'ent-001';
const USER_ID = 'user-001';

const adminActor: AuthoringActor = {
  user_id: USER_ID,
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

const auditorActor: AuthoringActor = {
  user_id: 'user-auditor',
  role: 'auditor',
  enterprise_id: ENTERPRISE_ID,
};

const otherEnterpriseActor: AuthoringActor = {
  user_id: USER_ID,
  role: 'treasury_manager',
  enterprise_id: 'ent-other',
};

const DRAFT_VERSION = {
  id: 'ver-draft',
  enterprise_id: ENTERPRISE_ID,
  version_number: 1,
  status: 'draft' as const,
  name: 'Draft v1',
  created_by: USER_ID,
  activated_at: null,
  activated_by: null,
};

const ACTIVE_VERSION = {
  id: 'ver-active',
  enterprise_id: ENTERPRISE_ID,
  version_number: 2,
  status: 'active' as const,
  name: 'Active v2',
  created_by: USER_ID,
  activated_at: new Date().toISOString(),
  activated_by: USER_ID,
};

const POLICY_ROW = {
  id: 'pol-001',
  enterprise_id: ENTERPRISE_ID,
  active_version_id: 'ver-active',
};

const SAMPLE_RULE = {
  id: 'rule-001',
  version_id: 'ver-draft',
  rule_type: 'approval_threshold',
  name: 'High value',
  rationale: 'Requires approval',
  condition: { kind: 'amount_compare', op: 'gte', value: { amount: '10000', currency: 'USD' } },
  verdict: 'require_approval',
  verdict_chain_id: 'chain-001',
  priority: 10,
  created_by: USER_ID,
  created_at: new Date().toISOString(),
};

const SAMPLE_CHAIN = {
  id: 'chain-001',
  version_id: 'ver-draft',
  name: 'CFO Approval',
  slots: [{ slot_index: 0, minimum_role: 'treasury_manager', label: 'CFO' }],
  trigger_condition: null,
  priority: 1,
  expiration_hours: 48,
  created_by: USER_ID,
  created_at: new Date().toISOString(),
};

const SAMPLE_LIMIT = {
  id: 'limit-001',
  version_id: 'ver-draft',
  limit_type: 'max_daily_outflow_usd',
  name: 'Daily cap',
  limit_value: '50000',
  limit_currency: 'USD',
  scope: {},
};

// ─── Task 7: Read operations ─────────────────────────────────────────────────

describe('Task 7 — getActiveVersion', () => {
  it('returns hydrated version when active_version_id is set', async () => {
    const db = mockSupabase({
      policy_policies: [POLICY_ROW],
      policy_versions: [DRAFT_VERSION, ACTIVE_VERSION],
      policy_rules: [SAMPLE_RULE],
      policy_hard_limits: [SAMPLE_LIMIT],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    const version = await svc.getActiveVersion(adminActor);
    expect(version).not.toBeNull();
    expect(version!.id).toBe('ver-active');
    expect(version!.status).toBe('active');
    // children scoped to ver-active not ver-draft, so empty (different version_id)
    expect(Array.isArray(version!.rules)).toBe(true);
  });

  it('returns null when no policy_policies row exists', async () => {
    const db = mockSupabase({});
    const svc = new PolicyAuthoringService(db);
    const version = await svc.getActiveVersion(adminActor);
    expect(version).toBeNull();
  });

  it('returns null when active_version_id is null', async () => {
    const db = mockSupabase({
      policy_policies: [{ ...POLICY_ROW, active_version_id: null }],
      policy_versions: [DRAFT_VERSION],
    });
    const svc = new PolicyAuthoringService(db);
    const version = await svc.getActiveVersion(adminActor);
    expect(version).toBeNull();
  });

  it('returns children belonging to the active version', async () => {
    const activeRule = { ...SAMPLE_RULE, id: 'rule-active', version_id: 'ver-active' };
    const db = mockSupabase({
      policy_policies: [POLICY_ROW],
      policy_versions: [ACTIVE_VERSION],
      policy_rules: [activeRule],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    const version = await svc.getActiveVersion(adminActor);
    expect(version!.rules).toHaveLength(1);
    expect(version!.rules[0].id).toBe('rule-active');
  });
});

describe('Task 7 — getVersionById', () => {
  it('returns full version when found for correct enterprise', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    const version = await svc.getVersionById(adminActor, 'ver-draft');
    expect(version.id).toBe('ver-draft');
  });

  it('throws when version belongs to different enterprise', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION], // enterprise_id = ent-001
    });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.getVersionById(otherEnterpriseActor, 'ver-draft')).rejects.toThrow(
      AuthoringError,
    );
  });

  it('throws when version does not exist', async () => {
    const db = mockSupabase({ policy_versions: [] });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.getVersionById(adminActor, 'nonexistent')).rejects.toThrow(AuthoringError);
  });
});

describe('Task 7 — listVersions', () => {
  it('returns all versions for the enterprise', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION, ACTIVE_VERSION],
    });
    const svc = new PolicyAuthoringService(db);
    const versions = await svc.listVersions(adminActor);
    expect(versions).toHaveLength(2);
  });

  it('does not return versions from a different enterprise', async () => {
    const foreignVersion = {
      ...DRAFT_VERSION,
      id: 'ver-foreign',
      enterprise_id: 'ent-other',
    };
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION, foreignVersion],
    });
    const svc = new PolicyAuthoringService(db);
    const versions = await svc.listVersions(adminActor);
    // Only DRAFT_VERSION belongs to ent-001
    expect(versions.every((v) => v.enterprise_id === ENTERPRISE_ID)).toBe(true);
  });

  it('returns empty array when no versions exist', async () => {
    const db = mockSupabase({ policy_versions: [] });
    const svc = new PolicyAuthoringService(db);
    const versions = await svc.listVersions(adminActor);
    expect(versions).toHaveLength(0);
  });

  it('returns shallow versions (children empty)', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [SAMPLE_RULE],
    });
    const svc = new PolicyAuthoringService(db);
    const versions = await svc.listVersions(adminActor);
    expect(versions[0].rules).toHaveLength(0);
  });
});

// ─── Task 8: Draft lifecycle ─────────────────────────────────────────────────

describe('Task 8 — createDraft', () => {
  it('creates an empty draft for a treasury_manager', async () => {
    const db = mockSupabase({ policy_versions: [] });
    const svc = new PolicyAuthoringService(db);
    const draft = await svc.createDraft(adminActor, { name: 'New Draft' });
    expect(draft.status).toBe('draft');
    expect(draft.name).toBe('New Draft');
    expect(draft.enterprise_id).toBe(ENTERPRISE_ID);
    expect(db._writes.some((w) => w.kind === 'insert' && w.table === 'policy_versions')).toBe(true);
  });

  it('assigns version_number 1 when no versions exist', async () => {
    const db = mockSupabase({ policy_versions: [] });
    const svc = new PolicyAuthoringService(db);
    const draft = await svc.createDraft(adminActor, { name: 'v1' });
    expect(draft.version_number).toBe(1);
  });

  it('increments version_number', async () => {
    const db = mockSupabase({ policy_versions: [DRAFT_VERSION] }); // version_number=1
    const svc = new PolicyAuthoringService(db);
    const draft = await svc.createDraft(adminActor, { name: 'v2' });
    expect(draft.version_number).toBe(2);
  });

  it('throws when actor lacks treasury_manager role', async () => {
    const db = mockSupabase({ policy_versions: [] });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.createDraft(auditorActor, { name: 'X' })).rejects.toThrow(AuthoringError);
  });

  it('copies children from source_version_id when provided', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [SAMPLE_RULE],
      policy_hard_limits: [SAMPLE_LIMIT],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    await svc.createDraft(adminActor, {
      name: 'Clone',
      source_version_id: 'ver-draft',
    });
    const ruleInserts = db._writes.filter(
      (w) => w.kind === 'insert' && w.table === 'policy_rules',
    );
    expect(ruleInserts.length).toBeGreaterThan(0);
  });
});

describe('Task 8 — cloneVersion', () => {
  it('clones a version with a default name', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    const clone = await svc.cloneVersion(adminActor, 'ver-draft');
    expect(clone.name).toBe('Draft v1 (copy)');
  });

  it('uses provided newName when given', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    const clone = await svc.cloneVersion(adminActor, 'ver-draft', 'My Clone');
    expect(clone.name).toBe('My Clone');
  });
});

describe('Task 8 — deleteDraft', () => {
  it('deletes a draft the actor created', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION], // created_by: USER_ID
    });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.deleteDraft(adminActor, 'ver-draft')).resolves.toBeUndefined();
    expect(db._writes.some((w) => w.kind === 'delete' && w.table === 'policy_versions')).toBe(true);
  });

  it('throws when version is active (not draft)', async () => {
    const db = mockSupabase({
      policy_versions: [ACTIVE_VERSION],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.deleteDraft(adminActor, 'ver-active')).rejects.toThrow(AuthoringError);
  });

  it('throws when actor is not the creator', async () => {
    const otherCreatorVersion = { ...DRAFT_VERSION, created_by: 'user-other' };
    const db = mockSupabase({
      policy_versions: [otherCreatorVersion],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.deleteDraft(adminActor, 'ver-draft')).rejects.toThrow(AuthoringError);
  });
});

// ─── Task 9: Rule CRUD ────────────────────────────────────────────────────────

describe('Task 9 — upsertRule', () => {
  const validRuleReq = {
    rule_type: 'approval_threshold' as const,
    name: 'Big transfer',
    rationale: 'Requires approval for large amounts',
    condition: {
      kind: 'amount_compare' as const,
      attr: 'transfer.amount' as const,
      op: '>=' as const,
      value: { amount: '5000', currency: 'USD' as const },
    },
    verdict: 'require_approval' as const,
    verdict_chain_id: 'chain-001',
    priority: 5,
  };

  it('creates a rule in a draft version', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    const result = await svc.upsertRule(adminActor, 'ver-draft', validRuleReq);
    expect(result.rules.length).toBeGreaterThan(0);
    expect(db._writes.some((w) => w.kind === 'upsert' && w.table === 'policy_rules')).toBe(true);
  });

  it('throws when version is active', async () => {
    const db = mockSupabase({
      policy_versions: [ACTIVE_VERSION],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.upsertRule(adminActor, 'ver-active', validRuleReq)).rejects.toThrow(
      AuthoringError,
    );
  });

  it('throws when actor lacks edit role', async () => {
    const db = mockSupabase({ policy_versions: [DRAFT_VERSION] });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.upsertRule(auditorActor, 'ver-draft', validRuleReq)).rejects.toThrow(
      AuthoringError,
    );
  });

  it('updates an existing rule when id is provided', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [SAMPLE_RULE],
      policy_hard_limits: [],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    const updated = await svc.upsertRule(adminActor, 'ver-draft', {
      ...validRuleReq,
      id: 'rule-001',
      name: 'Updated name',
      priority: 10,
    });
    expect(updated.rules.find((r) => r.id === 'rule-001')?.name).toBe('Updated name');
  });

  it('throws on priority collision (two rules with same priority)', async () => {
    const rule2 = { ...SAMPLE_RULE, id: 'rule-002', priority: 10 };
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [SAMPLE_RULE, rule2], // both priority=10
      policy_hard_limits: [],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    // Insert a 3rd rule with same priority — should trigger validateVersionCoherent
    await expect(
      svc.upsertRule(adminActor, 'ver-draft', { ...validRuleReq, priority: 10 }),
    ).rejects.toThrow(AuthoringError);
  });

  it('throws on rate-less asset condition', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    const badReq = {
      ...validRuleReq,
      verdict: 'allow_auto' as const,
      verdict_chain_id: undefined,
      condition: {
        kind: 'amount_compare' as const,
        attr: 'transfer.amount' as const,
        op: '>=' as const,
        value: { amount: '100', currency: 'USD' as const },
        scope: { asset: 'ETH' as unknown as import('../types/assets').AssetCode },
      },
    };
    await expect(svc.upsertRule(adminActor, 'ver-draft', badReq)).rejects.toThrow(AuthoringError);
  });
});

describe('Task 9 — deleteRule', () => {
  it('deletes a rule from a draft', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [SAMPLE_RULE],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    await svc.deleteRule(adminActor, 'ver-draft', 'rule-001');
    expect(db._writes.some((w) => w.kind === 'delete' && w.table === 'policy_rules')).toBe(true);
  });

  it('throws when version is active', async () => {
    const db = mockSupabase({ policy_versions: [ACTIVE_VERSION] });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.deleteRule(adminActor, 'ver-active', 'rule-001')).rejects.toThrow(
      AuthoringError,
    );
  });

  it('throws when actor lacks edit role', async () => {
    const db = mockSupabase({ policy_versions: [DRAFT_VERSION] });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.deleteRule(auditorActor, 'ver-draft', 'rule-001')).rejects.toThrow(
      AuthoringError,
    );
  });
});

// ─── Task 10: Hard limit CRUD ────────────────────────────────────────────────

const policyAdminProfile = {
  id: USER_ID,
  is_policy_admin: true,
  is_app_admin: false,
};

const appAdminProfile = {
  id: 'user-app-admin',
  is_policy_admin: false,
  is_app_admin: true,
};

const noAdminProfile = {
  id: 'user-no-admin',
  is_policy_admin: false,
  is_app_admin: false,
};

const validLimitReq = {
  limit_type: 'max_daily_outflow_usd' as const,
  name: 'Daily outflow cap',
  limit_value: '100000',
  limit_currency: 'USD' as const,
  scope: {},
};

const policyAdminActor: AuthoringActor = {
  user_id: USER_ID,
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

const appAdminActor: AuthoringActor = {
  user_id: 'user-app-admin',
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

const noAdminActor: AuthoringActor = {
  user_id: 'user-no-admin',
  role: 'treasury_manager',
  enterprise_id: ENTERPRISE_ID,
};

describe('Task 10 — upsertHardLimit', () => {
  it('creates a hard limit when actor is policy_admin', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
      user_profiles: [policyAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    const result = await svc.upsertHardLimit(policyAdminActor, 'ver-draft', validLimitReq);
    expect(result.hard_limits.length).toBeGreaterThan(0);
    expect(db._writes.some((w) => w.kind === 'upsert' && w.table === 'policy_hard_limits')).toBe(
      true,
    );
  });

  it('creates a hard limit when actor is app_admin', async () => {
    const db = mockSupabase({
      policy_versions: [{ ...DRAFT_VERSION, enterprise_id: ENTERPRISE_ID }],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
      user_profiles: [appAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    // app admin actor has different enterprise_id in version, but let's use same enterprise
    const actorForTest: AuthoringActor = { ...appAdminActor, enterprise_id: ENTERPRISE_ID };
    const result = await svc.upsertHardLimit(actorForTest, 'ver-draft', validLimitReq);
    expect(result.hard_limits.length).toBeGreaterThan(0);
  });

  it('throws when actor is not a policy admin', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
      user_profiles: [noAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.upsertHardLimit(noAdminActor, 'ver-draft', validLimitReq),
    ).rejects.toThrow(AuthoringError);
  });

  it('throws on negative/zero limit_value', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      user_profiles: [policyAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.upsertHardLimit(policyAdminActor, 'ver-draft', {
        ...validLimitReq,
        limit_value: '0',
      }),
    ).rejects.toThrow(AuthoringError);
  });

  it('throws when version is active', async () => {
    const db = mockSupabase({
      policy_versions: [ACTIVE_VERSION],
      user_profiles: [policyAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.upsertHardLimit(policyAdminActor, 'ver-active', validLimitReq),
    ).rejects.toThrow(AuthoringError);
  });
});

describe('Task 10 — deleteHardLimit', () => {
  it('deletes a hard limit when actor is policy_admin', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [SAMPLE_LIMIT],
      policy_approval_chains: [],
      user_profiles: [policyAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    await svc.deleteHardLimit(policyAdminActor, 'ver-draft', 'limit-001');
    expect(db._writes.some((w) => w.kind === 'delete' && w.table === 'policy_hard_limits')).toBe(
      true,
    );
  });

  it('throws when actor is not a policy admin', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      user_profiles: [noAdminProfile],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.deleteHardLimit(noAdminActor, 'ver-draft', 'limit-001'),
    ).rejects.toThrow(AuthoringError);
  });
});

// ─── Task 11: Approval chain CRUD ────────────────────────────────────────────

const validChainReq: import('./types').UpsertApprovalChainRequest = {
  name: 'Two-eye approval',
  slots: [
    { slot_index: 0, minimum_role: 'treasury_manager', label: 'CFO' },
  ],
  priority: 1,
  expiration_hours: 48,
};

describe('Task 11 — upsertApprovalChain', () => {
  it('creates a chain in a draft version', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [],
    });
    const svc = new PolicyAuthoringService(db);
    const result = await svc.upsertApprovalChain(adminActor, 'ver-draft', validChainReq);
    expect(result.approval_chains.length).toBeGreaterThan(0);
    expect(
      db._writes.some((w) => w.kind === 'upsert' && w.table === 'policy_approval_chains'),
    ).toBe(true);
  });

  it('throws on empty slots array', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.upsertApprovalChain(adminActor, 'ver-draft', { ...validChainReq, slots: [] }),
    ).rejects.toThrow(AuthoringError);
  });

  it('throws when version is active', async () => {
    const db = mockSupabase({
      policy_versions: [ACTIVE_VERSION],
    });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.upsertApprovalChain(adminActor, 'ver-active', validChainReq),
    ).rejects.toThrow(AuthoringError);
  });

  it('throws when actor lacks edit-chains role', async () => {
    const db = mockSupabase({ policy_versions: [DRAFT_VERSION] });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.upsertApprovalChain(auditorActor, 'ver-draft', validChainReq),
    ).rejects.toThrow(AuthoringError);
  });

  it('updates an existing chain when id is provided', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    const result = await svc.upsertApprovalChain(adminActor, 'ver-draft', {
      ...validChainReq,
      id: 'chain-001',
      name: 'Updated chain',
    });
    expect(result.approval_chains.find((c) => c.id === 'chain-001')?.name).toBe('Updated chain');
  });
});

describe('Task 11 — deleteApprovalChain', () => {
  it('deletes a chain from a draft', async () => {
    const db = mockSupabase({
      policy_versions: [DRAFT_VERSION],
      policy_rules: [],
      policy_hard_limits: [],
      policy_approval_chains: [SAMPLE_CHAIN],
    });
    const svc = new PolicyAuthoringService(db);
    await svc.deleteApprovalChain(adminActor, 'ver-draft', 'chain-001');
    expect(
      db._writes.some((w) => w.kind === 'delete' && w.table === 'policy_approval_chains'),
    ).toBe(true);
  });

  it('throws when version is active', async () => {
    const db = mockSupabase({ policy_versions: [ACTIVE_VERSION] });
    const svc = new PolicyAuthoringService(db);
    await expect(svc.deleteApprovalChain(adminActor, 'ver-active', 'chain-001')).rejects.toThrow(
      AuthoringError,
    );
  });

  it('throws when actor lacks edit-chains role', async () => {
    const db = mockSupabase({ policy_versions: [DRAFT_VERSION] });
    const svc = new PolicyAuthoringService(db);
    await expect(
      svc.deleteApprovalChain(auditorActor, 'ver-draft', 'chain-001'),
    ).rejects.toThrow(AuthoringError);
  });
});
