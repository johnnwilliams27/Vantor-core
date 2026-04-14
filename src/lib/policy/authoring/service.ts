import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { HardLimit } from '../types/hard-limit';
import { REASON_CODES } from '../errors/reason-codes';
import { AuthoringError } from './errors';
import {
  AuthoringActor,
  ActivateRequest,
  CreateDraftRequest,
  UpsertRuleRequest,
  UpsertHardLimitRequest,
  UpsertApprovalChainRequest,
  VersionDiff,
  SatisfiabilityResult,
} from './types';
import {
  canCreateDraft,
  canEditDraftRules,
  canEditDraftChains,
  requirePolicyAdmin,
} from './permissions';
import {
  validateRuleInput,
  validateHardLimitInput,
  validateApprovalChainInput,
  validateVersionCoherent,
} from './validation';
import { computeVersionDiff } from './diff';
import { checkChainSatisfiability, SatisfiabilityUserRow } from './satisfiability';

// ─── Minimal SupabaseLike type ──────────────────────────────────────────────

export type SupabaseLike = {
  from: (table: string) => unknown;
  rpc?: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

// ─── Row shapes from DB ─────────────────────────────────────────────────────

interface PolicyPolicyRow {
  id: string;
  enterprise_id: string;
  active_version_id: string | null;
}

interface PolicyVersionRow {
  id: string;
  enterprise_id: string;
  version_number: number;
  status: 'draft' | 'active' | 'superseded';
  name: string;
  activated_at?: string | null;
  activated_by?: string | null;
  created_by: string;
}

interface PolicyRuleRow {
  id: string;
  version_id: string;
  rule_type: PolicyRule['rule_type'];
  name: string;
  rationale: string;
  condition: unknown;
  verdict: string;
  verdict_chain_id?: string | null;
  priority: number;
  created_by: string;
  created_at: string;
}

interface HardLimitRow {
  id: string;
  version_id: string;
  limit_type: string;
  name: string;
  limit_value: string;
  limit_currency?: string | null;
  scope: unknown;
}

interface ApprovalChainRow {
  id: string;
  version_id: string;
  name: string;
  slots: unknown;
  trigger_condition?: unknown | null;
  priority: number;
  expiration_hours: number;
  created_by: string;
  created_at: string;
}

interface UserProfileRow {
  id: string;
  enterprise_id: string;
  role: string;
  is_policy_admin?: boolean;
  is_app_admin?: boolean;
}

// ─── Query builder helpers ──────────────────────────────────────────────────

type SelectBuilder<T> = {
  select: (cols?: string) => SelectBuilder<T>;
  eq: (col: string, val: unknown) => SelectBuilder<T>;
  in: (col: string, vals: unknown[]) => SelectBuilder<T>;
  order: (col: string, opts?: { ascending?: boolean }) => SelectBuilder<T>;
  limit: (n: number) => SelectBuilder<T>;
  single: () => Promise<{ data: T | null; error: unknown }>;
  maybeSingle: () => Promise<{ data: T | null; error: unknown }>;
  then: Promise<{ data: T[] | null; error: unknown }>['then'];
};

function tableFrom<T>(supabase: SupabaseLike, table: string) {
  return (supabase as { from: (t: string) => SelectBuilder<T> }).from(table);
}

// ─── Row → domain type converters ──────────────────────────────────────────

function rowToRule(r: PolicyRuleRow): PolicyRule {
  return {
    id: r.id,
    version_id: r.version_id,
    rule_type: r.rule_type,
    name: r.name,
    rationale: r.rationale,
    condition: r.condition as PolicyRule['condition'],
    verdict: r.verdict as PolicyRule['verdict'],
    verdict_chain_id: r.verdict_chain_id ?? undefined,
    priority: r.priority,
    created_by: r.created_by,
    created_at: new Date(r.created_at),
  };
}

function rowToLimit(r: HardLimitRow): HardLimit {
  return {
    id: r.id,
    limit_type: r.limit_type as HardLimit['limit_type'],
    name: r.name,
    limit_value: r.limit_value,
    limit_currency: (r.limit_currency ?? undefined) as HardLimit['limit_currency'],
    scope: r.scope as HardLimit['scope'],
  };
}

function rowToChain(r: ApprovalChainRow): ApprovalChain {
  return {
    id: r.id,
    version_id: r.version_id,
    name: r.name,
    slots: r.slots as ApprovalChain['slots'],
    trigger_condition: (r.trigger_condition ?? undefined) as ApprovalChain['trigger_condition'],
    priority: r.priority,
    expiration_hours: r.expiration_hours,
    created_by: r.created_by,
    created_at: new Date(r.created_at),
  };
}

function rowToVersion(
  row: PolicyVersionRow,
  rules: PolicyRuleRow[],
  limits: HardLimitRow[],
  chains: ApprovalChainRow[],
): PolicyVersionSnapshot {
  return {
    id: row.id,
    enterprise_id: row.enterprise_id,
    version_number: row.version_number,
    status: row.status,
    name: row.name,
    activated_at: row.activated_at ? new Date(row.activated_at) : undefined,
    activated_by: row.activated_by ?? undefined,
    rules: rules.map(rowToRule),
    hard_limits: limits.map(rowToLimit),
    approval_chains: chains.map(rowToChain),
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export class PolicyAuthoringService {
  constructor(private readonly supabase: SupabaseLike) {}

  // ── Private helpers ──────────────────────────────────────────────────────

  private async fetchChildren<T>(table: string, versionId: string): Promise<T[]> {
    const q = tableFrom<T>(this.supabase, table);
    // Real Supabase v2 requires .select() before filter methods.
    const result = await (q.select('*').eq('version_id', versionId) as unknown as Promise<{
      data: T[] | null;
      error: unknown;
    }>);
    if (result.error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Failed to load ${table} for version ${versionId}.`,
        user_action: 'Try again or contact support.',
        details: { table, version_id: versionId, error: result.error },
      });
    }
    return result.data ?? [];
  }

  private async loadVersionWithChildren(
    enterpriseId: string,
    versionId: string,
  ): Promise<PolicyVersionSnapshot | null> {
    const { data: row, error } = await tableFrom<PolicyVersionRow>(
      this.supabase,
      'policy_versions',
    )
      .select('*')
      .eq('id', versionId)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Failed to load policy version ${versionId}.`,
        user_action: 'Try again or contact support.',
        details: { version_id: versionId, error },
      });
    }
    if (!row) return null;

    const [rules, limits, chains] = await Promise.all([
      this.fetchChildren<PolicyRuleRow>('policy_rules', versionId),
      this.fetchChildren<HardLimitRow>('policy_hard_limits', versionId),
      this.fetchChildren<ApprovalChainRow>('policy_approval_chains', versionId),
    ]);

    return rowToVersion(row, rules, limits, chains);
  }

  private async requireDraftVersion(
    actor: AuthoringActor,
    versionId: string,
  ): Promise<PolicyVersionSnapshot> {
    const version = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!version) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version '${versionId}' not found.`,
        user_action: 'Check the version ID and try again.',
        details: { version_id: versionId },
      });
    }
    if (version.status !== 'draft') {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version '${versionId}' has status '${version.status}' and cannot be edited. Only draft versions are editable.`,
        user_action: 'Create a new draft to make changes.',
        details: { version_id: versionId, status: version.status },
      });
    }
    return version;
  }

  private async fetchNextVersionNumber(enterpriseId: string): Promise<number> {
    // We need MAX(version_number) for the enterprise, then +1
    // Using a select with order + limit=1
    const q = tableFrom<PolicyVersionRow>(this.supabase, 'policy_versions');
    const result = await (
      q
        .select('version_number')
        .eq('enterprise_id', enterpriseId)
        .order('version_number', { ascending: false })
        .limit(1) as unknown as Promise<{ data: PolicyVersionRow[] | null; error: unknown }>
    );
    if (result.error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to determine next version number.',
        user_action: 'Try again or contact support.',
        details: { enterprise_id: enterpriseId, error: result.error },
      });
    }
    const rows = result.data ?? [];
    return rows.length === 0 ? 1 : rows[0].version_number + 1;
  }

  // ── Task 7: Read operations ──────────────────────────────────────────────

  async getActiveVersion(actor: AuthoringActor): Promise<PolicyVersionSnapshot | null> {
    // Find the policy_policies row for this enterprise
    const { data: policy, error: policyError } = await tableFrom<PolicyPolicyRow>(
      this.supabase,
      'policy_policies',
    )
      .select('*')
      .eq('enterprise_id', actor.enterprise_id)
      .maybeSingle();

    if (policyError) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to load enterprise policy record.',
        user_action: 'Try again or contact support.',
        details: { enterprise_id: actor.enterprise_id, error: policyError },
      });
    }
    if (!policy || !policy.active_version_id) return null;

    return this.loadVersionWithChildren(actor.enterprise_id, policy.active_version_id);
  }

  async getVersionById(
    actor: AuthoringActor,
    versionId: string,
  ): Promise<PolicyVersionSnapshot> {
    const version = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!version) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version '${versionId}' not found.`,
        user_action: 'Check the version ID and try again.',
        details: { version_id: versionId, enterprise_id: actor.enterprise_id },
      });
    }
    return version;
  }

  async listVersions(actor: AuthoringActor): Promise<PolicyVersionSnapshot[]> {
    const q = tableFrom<PolicyVersionRow>(this.supabase, 'policy_versions');
    const result = await (
      q
        .select('*')
        .eq('enterprise_id', actor.enterprise_id)
        .order('version_number', { ascending: false }) as unknown as Promise<{
        data: PolicyVersionRow[] | null;
        error: unknown;
      }>
    );
    if (result.error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to list policy versions.',
        user_action: 'Try again or contact support.',
        details: { enterprise_id: actor.enterprise_id, error: result.error },
      });
    }
    const rows = result.data ?? [];
    // Shallow — return versions with empty children arrays
    return rows.map((row) => rowToVersion(row, [], [], []));
  }

  // ── Task 8: Draft lifecycle ──────────────────────────────────────────────

  async createDraft(
    actor: AuthoringActor,
    req: CreateDraftRequest,
  ): Promise<PolicyVersionSnapshot> {
    if (!canCreateDraft(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Creating a policy draft requires treasury_manager role or above.',
        user_action: 'Ask an admin to upgrade your role.',
        details: { role: actor.role },
      });
    }

    const nextNumber = await this.fetchNextVersionNumber(actor.enterprise_id);

    const insertQ = tableFrom<PolicyVersionRow>(this.supabase, 'policy_versions') as unknown as {
      insert: (row: Record<string, unknown>) => {
        select: () => {
          single: () => Promise<{ data: PolicyVersionRow | null; error: unknown }>;
        };
      };
    };

    const { data: newRow, error: insertError } = await insertQ
      .insert({
        enterprise_id: actor.enterprise_id,
        version_number: nextNumber,
        status: 'draft',
        name: req.name,
        created_by: actor.user_id,
      })
      .select()
      .single();

    if (insertError || !newRow) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to create policy draft.',
        user_action: 'Try again or contact support.',
        details: { error: insertError },
      });
    }

    const versionId = newRow.id;

    // Optionally copy children from source version
    if (req.source_version_id) {
      const [sourceRules, sourceLimits, sourceChains] = await Promise.all([
        this.fetchChildren<PolicyRuleRow>('policy_rules', req.source_version_id),
        this.fetchChildren<HardLimitRow>('policy_hard_limits', req.source_version_id),
        this.fetchChildren<ApprovalChainRow>('policy_approval_chains', req.source_version_id),
      ]);

      const copyQ = (table: string) =>
        tableFrom<unknown>(this.supabase, table) as unknown as {
          insert: (rows: Record<string, unknown>[]) => Promise<{ data: unknown[] | null; error: unknown }>;
        };

      const throwIfCopyFailed = (table: string, error: unknown) => {
        if (!error) return;
        throw new AuthoringError({
          reason_code: REASON_CODES.gate_internal_error,
          human_readable: `Draft created but failed to copy ${table} from source version.`,
          user_action: 'Delete the partial draft and try again, or contact support.',
          details: { table, version_id: versionId, error },
        });
      };

      if (sourceRules.length > 0) {
        const { error } = await copyQ('policy_rules').insert(
          sourceRules.map(({ id: _id, version_id: _vid, created_at: _cat, ...rest }) => ({
            ...rest,
            version_id: versionId,
            created_by: actor.user_id,
          })),
        );
        throwIfCopyFailed('policy_rules', error);
      }
      if (sourceLimits.length > 0) {
        const { error } = await copyQ('policy_hard_limits').insert(
          sourceLimits.map(({ id: _id, version_id: _vid, ...rest }) => ({
            ...rest,
            version_id: versionId,
          })),
        );
        throwIfCopyFailed('policy_hard_limits', error);
      }
      if (sourceChains.length > 0) {
        const { error } = await copyQ('policy_approval_chains').insert(
          sourceChains.map(({ id: _id, version_id: _vid, created_at: _cat, ...rest }) => ({
            ...rest,
            version_id: versionId,
            created_by: actor.user_id,
          })),
        );
        throwIfCopyFailed('policy_approval_chains', error);
      }
    }

    const created = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!created) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Draft was created but could not be reloaded.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    return created;
  }

  async cloneVersion(
    actor: AuthoringActor,
    sourceId: string,
    newName?: string,
  ): Promise<PolicyVersionSnapshot> {
    const source = await this.getVersionById(actor, sourceId);
    return this.createDraft(actor, {
      name: newName ?? `${source.name} (copy)`,
      source_version_id: sourceId,
    });
  }

  async deleteDraft(actor: AuthoringActor, versionId: string): Promise<void> {
    const version = await this.requireDraftVersion(actor, versionId);

    // Load the raw row to check created_by
    const rawQ = tableFrom<PolicyVersionRow>(this.supabase, 'policy_versions') as unknown as {
      eq: (col: string, val: string) => unknown;
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            single: () => Promise<{ data: PolicyVersionRow | null; error: unknown }>;
          };
        };
      };
    };
    const { data: rawRow } = await rawQ
      .select('id, created_by, status, enterprise_id, version_number, name')
      .eq('id', versionId)
      .eq('enterprise_id', actor.enterprise_id)
      .single();

    if (rawRow && rawRow.created_by !== actor.user_id) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Only the creator of a draft can delete it.',
        user_action: 'Ask the original draft creator to delete it, or contact an admin.',
        details: { version_id: versionId, created_by: rawRow.created_by, actor: actor.user_id },
      });
    }

    // We have a valid draft owned by this actor — delete it
    const deleteQ = tableFrom<PolicyVersionRow>(this.supabase, 'policy_versions') as unknown as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    const { error } = await deleteQ.delete().eq('id', versionId).eq('enterprise_id', actor.enterprise_id);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to delete policy draft.',
        user_action: 'Try again or contact support.',
        details: { version_id: versionId, error },
      });
    }

    // suppress unused variable warning
    void version;
  }

  // ── Task 9: Rule CRUD ────────────────────────────────────────────────────

  async upsertRule(
    actor: AuthoringActor,
    versionId: string,
    req: UpsertRuleRequest,
  ): Promise<PolicyVersionSnapshot> {
    if (!canEditDraftRules(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Editing policy rules requires treasury_manager role or above.',
        user_action: 'Ask an admin to upgrade your role.',
        details: { role: actor.role },
      });
    }

    await this.requireDraftVersion(actor, versionId);
    validateRuleInput(req);

    const table = tableFrom<PolicyRuleRow>(this.supabase, 'policy_rules') as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ data: PolicyRuleRow | null; error: unknown }>;
    };

    const { error } = await table.upsert(
      {
        ...(req.id ? { id: req.id } : {}),
        version_id: versionId,
        rule_type: req.rule_type,
        name: req.name,
        rationale: req.rationale,
        condition: req.condition,
        verdict: req.verdict,
        verdict_chain_id: req.verdict_chain_id ?? null,
        priority: req.priority,
        created_by: actor.user_id,
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to save rule.',
        user_action: 'Try again or contact support.',
        details: { version_id: versionId, error },
      });
    }

    const updated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!updated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after rule upsert.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    validateVersionCoherent(updated);
    return updated;
  }

  async deleteRule(
    actor: AuthoringActor,
    versionId: string,
    ruleId: string,
  ): Promise<PolicyVersionSnapshot> {
    if (!canEditDraftRules(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Editing policy rules requires treasury_manager role or above.',
        user_action: 'Ask an admin to upgrade your role.',
        details: { role: actor.role },
      });
    }

    await this.requireDraftVersion(actor, versionId);

    const deleteQ = tableFrom<PolicyRuleRow>(this.supabase, 'policy_rules') as unknown as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    const { error } = await deleteQ.delete().eq('id', ruleId).eq('version_id', versionId);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to delete rule.',
        user_action: 'Try again or contact support.',
        details: { rule_id: ruleId, version_id: versionId, error },
      });
    }

    const updated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!updated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after rule delete.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    return updated;
  }

  // ── Task 10: Hard limit CRUD ─────────────────────────────────────────────

  async upsertHardLimit(
    actor: AuthoringActor,
    versionId: string,
    req: UpsertHardLimitRequest,
  ): Promise<PolicyVersionSnapshot> {
    await requirePolicyAdmin(this.supabase as Parameters<typeof requirePolicyAdmin>[0], actor.user_id);
    await this.requireDraftVersion(actor, versionId);
    validateHardLimitInput(req);

    const table = tableFrom<HardLimitRow>(this.supabase, 'policy_hard_limits') as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ data: HardLimitRow | null; error: unknown }>;
    };

    const { error } = await table.upsert(
      {
        ...(req.id ? { id: req.id } : {}),
        version_id: versionId,
        limit_type: req.limit_type,
        name: req.name,
        limit_value: req.limit_value,
        limit_currency: req.limit_currency ?? null,
        scope: req.scope,
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to save hard limit.',
        user_action: 'Try again or contact support.',
        details: { version_id: versionId, error },
      });
    }

    const updated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!updated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after hard limit upsert.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    validateVersionCoherent(updated);
    return updated;
  }

  async deleteHardLimit(
    actor: AuthoringActor,
    versionId: string,
    limitId: string,
  ): Promise<PolicyVersionSnapshot> {
    await requirePolicyAdmin(this.supabase as Parameters<typeof requirePolicyAdmin>[0], actor.user_id);
    await this.requireDraftVersion(actor, versionId);

    const deleteQ = tableFrom<HardLimitRow>(this.supabase, 'policy_hard_limits') as unknown as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    const { error } = await deleteQ.delete().eq('id', limitId).eq('version_id', versionId);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to delete hard limit.',
        user_action: 'Try again or contact support.',
        details: { limit_id: limitId, version_id: versionId, error },
      });
    }

    const updated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!updated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after hard limit delete.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    return updated;
  }

  // ── Task 11: Approval chain CRUD ─────────────────────────────────────────

  async upsertApprovalChain(
    actor: AuthoringActor,
    versionId: string,
    req: UpsertApprovalChainRequest,
  ): Promise<PolicyVersionSnapshot> {
    if (!canEditDraftChains(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Editing approval chains requires treasury_manager role or above.',
        user_action: 'Ask an admin to upgrade your role.',
        details: { role: actor.role },
      });
    }

    await this.requireDraftVersion(actor, versionId);
    validateApprovalChainInput(req);

    const table = tableFrom<ApprovalChainRow>(this.supabase, 'policy_approval_chains') as unknown as {
      upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => Promise<{ data: ApprovalChainRow | null; error: unknown }>;
    };

    const { error } = await table.upsert(
      {
        ...(req.id ? { id: req.id } : {}),
        version_id: versionId,
        name: req.name,
        slots: req.slots,
        trigger_condition: req.trigger_condition ?? null,
        priority: req.priority,
        expiration_hours: req.expiration_hours ?? 24,
        created_by: actor.user_id,
      },
      { onConflict: 'id' },
    );

    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to save approval chain.',
        user_action: 'Try again or contact support.',
        details: { version_id: versionId, error },
      });
    }

    const updated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!updated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after chain upsert.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    return updated;
  }

  async deleteApprovalChain(
    actor: AuthoringActor,
    versionId: string,
    chainId: string,
  ): Promise<PolicyVersionSnapshot> {
    if (!canEditDraftChains(actor.role)) {
      throw new AuthoringError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Editing approval chains requires treasury_manager role or above.',
        user_action: 'Ask an admin to upgrade your role.',
        details: { role: actor.role },
      });
    }

    await this.requireDraftVersion(actor, versionId);

    const deleteQ = tableFrom<ApprovalChainRow>(this.supabase, 'policy_approval_chains') as unknown as {
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    const { error } = await deleteQ.delete().eq('id', chainId).eq('version_id', versionId);
    if (error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to delete approval chain.',
        user_action: 'Try again or contact support.',
        details: { chain_id: chainId, version_id: versionId, error },
      });
    }

    const updated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!updated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after chain delete.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    return updated;
  }

  // ── Task 12: Private helper — fetch enterprise users ────────────────────

  private async fetchEnterpriseUsers(enterpriseId: string): Promise<SatisfiabilityUserRow[]> {
    const q = tableFrom<UserProfileRow>(this.supabase, 'user_profiles');
    const result = await (
      q.select('id, role, is_policy_admin, is_app_admin').eq('enterprise_id', enterpriseId) as unknown as Promise<{
        data: UserProfileRow[] | null;
        error: unknown;
      }>
    );
    if (result.error) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to load enterprise users for satisfiability check.',
        user_action: 'Try again or contact support.',
        details: { enterprise_id: enterpriseId, error: result.error },
      });
    }
    const rows = result.data ?? [];
    return rows.map((r) => ({ user_id: r.id, role: r.role as SatisfiabilityUserRow['role'] }));
  }

  // ── Task 12: activateVersion ─────────────────────────────────────────────

  async activateVersion(
    actor: AuthoringActor,
    versionId: string,
    req: ActivateRequest,
  ): Promise<PolicyVersionSnapshot> {
    // 1. Require policy admin
    await requirePolicyAdmin(
      this.supabase as Parameters<typeof requirePolicyAdmin>[0],
      actor.user_id,
    );

    // 2. Check reason length
    if (req.reason.trim().length < 20) {
      throw new AuthoringError({
        reason_code: REASON_CODES.activation_reason_too_short,
        human_readable:
          'Activation reason must be at least 20 characters. Provide a meaningful explanation for the activation.',
        user_action: 'Enter a longer activation reason (minimum 20 characters).',
        details: { length: req.reason.trim().length },
      });
    }

    // 3. Load draft fresh, verify status='draft'
    const draft = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!draft) {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version '${versionId}' not found.`,
        user_action: 'Check the version ID and try again.',
        details: { version_id: versionId },
      });
    }
    if (draft.status !== 'draft') {
      throw new AuthoringError({
        reason_code: REASON_CODES.version_not_draft,
        human_readable: `Policy version '${versionId}' has status '${draft.status}' and cannot be activated. Only draft versions may be activated.`,
        user_action: 'Create a new draft to make changes.',
        details: { version_id: versionId, status: draft.status },
      });
    }

    // 4a. Empty-draft guard — a policy with 0 rules is almost certainly a mistake
    if (draft.rules.length === 0) {
      throw new AuthoringError({
        reason_code: REASON_CODES.activation_blocked_by_validation,
        human_readable: 'Cannot activate a policy with zero rules. Add at least one rule before activating.',
        user_action: 'Add rules to the draft before activating.',
        details: { version_id: versionId, rule_count: 0 },
      });
    }

    // 4b. Re-run validateVersionCoherent (wrap errors in activation_blocked_by_validation)
    try {
      validateVersionCoherent(draft);
    } catch (err) {
      if (err instanceof AuthoringError) {
        throw new AuthoringError({
          reason_code: REASON_CODES.activation_blocked_by_validation,
          human_readable: `Activation blocked: the draft failed coherence validation. ${err.human_readable}`,
          user_action: err.user_action,
          details: { original_reason_code: err.reason_code, ...err.details },
        });
      }
      throw err;
    }

    // 5. Check chain satisfiability against live user base
    const users = await this.fetchEnterpriseUsers(actor.enterprise_id);
    for (const chain of draft.approval_chains) {
      const result = checkChainSatisfiability(chain, users);
      if (!result.satisfiable) {
        throw new AuthoringError({
          reason_code: REASON_CODES.chain_unsatisfiable_at_activation,
          human_readable: `Approval chain '${chain.name}' cannot be satisfied by current enterprise users. Assign users with sufficient roles before activating.`,
          user_action: 'Add users with the required roles or adjust the chain slots.',
          details: {
            chain_id: chain.id,
            chain_name: chain.name,
            unsatisfied_slots: result.unsatisfied_slots,
          },
        });
      }
    }

    // 6. Call the atomic PG RPC. Call through this.supabase so the
    // Supabase client keeps its `this` binding — detaching the method
    // (`const rpc = supabase.rpc`) and invoking it standalone throws
    // "Cannot read properties of undefined (reading 'rest')" at runtime
    // because the real client reads `this.rest` from inside rpc().
    const supabase = this.supabase as { rpc?: NonNullable<SupabaseLike['rpc']> };
    if (!supabase.rpc) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Activation RPC is not available in this context.',
        user_action: 'Contact support.',
        details: {},
      });
    }

    const { error: rpcError } = await supabase.rpc('policy_activate_draft', {
      p_version_id: versionId,
      p_enterprise_id: actor.enterprise_id,
      p_activated_by: actor.user_id,
      p_reason: req.reason,
    });

    // 7. Map RPC errors
    if (rpcError) {
      const code = (rpcError as { code?: string }).code;
      if (code === 'P0001') {
        throw new AuthoringError({
          reason_code: REASON_CODES.activation_reason_too_short,
          human_readable: 'Activation reason rejected by the database: too short.',
          user_action: 'Provide a longer activation reason.',
          details: { rpc_error: rpcError },
        });
      }
      if (code === 'P0002') {
        throw new AuthoringError({
          reason_code: REASON_CODES.version_not_draft,
          human_readable: 'The version is no longer in draft status.',
          user_action: 'Reload the version and try again.',
          details: { rpc_error: rpcError },
        });
      }
      throw new AuthoringError({
        reason_code: REASON_CODES.activation_race_conflict,
        human_readable: 'Activation failed — the policy may have been modified concurrently.',
        user_action: 'Reload the version and retry activation.',
        details: { rpc_error: rpcError },
      });
    }

    // 8. Return reloaded version
    const activated = await this.loadVersionWithChildren(actor.enterprise_id, versionId);
    if (!activated) {
      throw new AuthoringError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Version disappeared after activation.',
        user_action: 'Contact support.',
        details: { version_id: versionId },
      });
    }
    return activated;
  }

  // ── Task 13: diffVersions wrapper ────────────────────────────────────────

  async diffVersions(
    actor: AuthoringActor,
    fromVersionId: string,
    toVersionId: string,
  ): Promise<VersionDiff> {
    const [from, to] = await Promise.all([
      this.getVersionById(actor, fromVersionId),
      this.getVersionById(actor, toVersionId),
    ]);
    return computeVersionDiff(from, to);
  }

  // ── Task 13: checkSatisfiability wrapper ─────────────────────────────────

  async checkSatisfiability(
    actor: AuthoringActor,
    versionId: string,
  ): Promise<SatisfiabilityResult> {
    const version = await this.getVersionById(actor, versionId);
    const users = await this.fetchEnterpriseUsers(actor.enterprise_id);
    const chainResults = version.approval_chains.map((chain) =>
      checkChainSatisfiability(chain, users),
    );
    return {
      version_id: versionId,
      all_satisfiable: chainResults.every((r) => r.satisfiable),
      chain_results: chainResults.map((r) => ({
        chain_id: r.chain_id,
        chain_name: r.chain_name,
        satisfiable: r.satisfiable,
        unsatisfied_slots: r.unsatisfied_slots as SatisfiabilityResult['chain_results'][number]['unsatisfied_slots'],
      })),
    };
  }
}
