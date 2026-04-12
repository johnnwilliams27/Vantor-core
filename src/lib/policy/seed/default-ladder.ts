/**
 * Default approval ladder + RBAC settings seeder.
 *
 * Provides a sensible starting policy for a new (or un-seeded) Vantor
 * enterprise. The ladder matches the product-level thresholds locked
 * in the RBAC hierarchy plan:
 *
 *   > $50K   → require_approval, single treasury_manager slot
 *   > $500K  → require_approval, two treasury_manager slots
 *   > $1M    → require_approval, one treasury_manager + one executive slot
 *
 * Rule priorities are set so the tightest constraint matches first
 * (higher number = higher precedence). Guardrail-safe: the $500K
 * rule routes to a 2-slot chain and the $1M rule routes to a chain
 * with an executive slot, both of which satisfy the
 * validateChainSizeGuardrails check at activation time.
 *
 * Idempotency:
 *   - If the enterprise already has an active policy version, this
 *     function LEAVES THE POLICY ALONE and only ensures the
 *     enterprise_rbac_settings row exists. It will NOT re-seed over
 *     a live policy.
 *   - The enterprise_rbac_settings upsert uses ignoreDuplicates so
 *     it never overwrites an existing row.
 *
 * Intended callers:
 *   - Enterprise onboarding flow (future hook)
 *   - scripts/seed-default-approval-ladder.ts (one-off backfill)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRbacSettings } from '@/lib/auth/rbac-settings';

export interface SeedResult {
  enterpriseId: string;
  policyVersionId?: string; // populated when a version was created
  policySkipped: boolean; // true if an active version already existed
  rbacSettingsEnsured: boolean;
}

interface ChainSpec {
  key: string; // stable name key for dedup
  name: string;
  slots: Array<{ slot_index: number; minimum_role: string; label?: string }>;
}

interface RuleSpec {
  key: string; // stable rule name for dedup
  name: string;
  rationale: string;
  thresholdUsd: number; // for condition + priority
  chainKey: string; // matches ChainSpec.key
  priority: number;
}

const DEFAULT_CHAINS: ChainSpec[] = [
  {
    key: 'vantor.default.single_approver',
    name: 'Single Approver',
    slots: [{ slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury Manager' }],
  },
  {
    key: 'vantor.default.dual_approver',
    name: 'Dual Approver',
    slots: [
      { slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury Manager (1)' },
      { slot_index: 1, minimum_role: 'treasury_manager', label: 'Treasury Manager (2)' },
    ],
  },
  {
    key: 'vantor.default.executive_dual',
    name: 'Executive Approval',
    slots: [
      { slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury Manager' },
      { slot_index: 1, minimum_role: 'executive', label: 'Executive' },
    ],
  },
];

const DEFAULT_RULES: RuleSpec[] = [
  // Highest priority — seven-figure transfers always route to executive.
  {
    key: 'vantor.default.rule.over_1m',
    name: 'Transfers over $1M require executive approval',
    rationale: 'Seven-figure and larger movements require a senior approver on the chain.',
    thresholdUsd: 1_000_000,
    chainKey: 'vantor.default.executive_dual',
    priority: 300,
  },
  {
    key: 'vantor.default.rule.over_500k',
    name: 'Transfers over $500K require dual approval',
    rationale: 'High-value movements require two distinct approvers.',
    thresholdUsd: 500_000,
    chainKey: 'vantor.default.dual_approver',
    priority: 200,
  },
  {
    key: 'vantor.default.rule.over_50k',
    name: 'Transfers over $50K require approval',
    rationale: 'Standard treasury approval threshold for routine movements above operating cash.',
    thresholdUsd: 50_000,
    chainKey: 'vantor.default.single_approver',
    priority: 100,
  },
];

/**
 * Seed the default approval ladder + ensure RBAC settings row.
 * Returns a summary with what was done.
 */
export async function seedDefaultApprovalLadder(
  enterpriseId: string,
  actorUserId: string,
  client: SupabaseClient,
): Promise<SeedResult> {
  // Always ensure the rbac_settings row — cheap, idempotent, no
  // dependency on policy state.
  await resolveRbacSettings(enterpriseId, client);

  // Skip the policy seed if the enterprise already has an active
  // version. Re-seeding over a live policy would be a disaster.
  const { data: policyRow } = await client
    .from('policy_policies')
    .select('id, active_version_id')
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();

  if (policyRow?.active_version_id) {
    return {
      enterpriseId,
      policySkipped: true,
      rbacSettingsEnsured: true,
    };
  }

  // Compute the next version_number for this enterprise.
  const { data: existingVersions } = await client
    .from('policy_versions')
    .select('version_number')
    .eq('enterprise_id', enterpriseId)
    .order('version_number', { ascending: false })
    .limit(1);

  const nextVersionNumber =
    ((existingVersions?.[0]?.version_number as number | undefined) ?? 0) + 1;

  // Create the version as 'active' immediately. This is a seed path —
  // there's no human in the loop reviewing a draft. The activate RPC
  // exists for the interactive flow, not bootstrap.
  const { data: version, error: versionErr } = await client
    .from('policy_versions')
    .insert({
      enterprise_id: enterpriseId,
      version_number: nextVersionNumber,
      status: 'active',
      name: 'Default Approval Ladder',
      created_by: actorUserId,
      activated_at: new Date().toISOString(),
      activated_by: actorUserId,
    })
    .select('id')
    .single();

  if (versionErr || !version) {
    throw new Error(
      `Failed to create policy version for enterprise ${enterpriseId}: ${versionErr?.message ?? 'no row'}`,
    );
  }

  const versionId = version.id as string;

  // Insert the three chains, capturing ids for the rule FKs.
  const chainIds = new Map<string, string>();
  for (const spec of DEFAULT_CHAINS) {
    const { data: chain, error: chainErr } = await client
      .from('policy_approval_chains')
      .insert({
        version_id: versionId,
        name: spec.name,
        slots: spec.slots,
        priority: 0,
        expiration_hours: 48,
        created_by: actorUserId,
      })
      .select('id')
      .single();
    if (chainErr || !chain) {
      throw new Error(
        `Failed to create chain '${spec.name}' for enterprise ${enterpriseId}: ${chainErr?.message ?? 'no row'}`,
      );
    }
    chainIds.set(spec.key, chain.id as string);
  }

  // Insert the three rules wired to the chains.
  for (const spec of DEFAULT_RULES) {
    const chainId = chainIds.get(spec.chainKey);
    if (!chainId) {
      throw new Error(`Internal: chain key ${spec.chainKey} not seeded`);
    }
    const { error: ruleErr } = await client
      .from('policy_rules')
      .insert({
        version_id: versionId,
        rule_type: 'approval_threshold',
        name: spec.name,
        rationale: spec.rationale,
        condition: {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: String(spec.thresholdUsd), currency: 'USD' },
        },
        verdict: 'require_approval',
        verdict_chain_id: chainId,
        priority: spec.priority,
        created_by: actorUserId,
      });
    if (ruleErr) {
      throw new Error(
        `Failed to create rule '${spec.name}' for enterprise ${enterpriseId}: ${ruleErr.message}`,
      );
    }
  }

  // Upsert the policy_policies pointer to the new active version.
  const { error: policyErr } = await client
    .from('policy_policies')
    .upsert(
      {
        enterprise_id: enterpriseId,
        name: 'Standard Policy',
        active_version_id: versionId,
      },
      { onConflict: 'enterprise_id' },
    );
  if (policyErr) {
    throw new Error(
      `Failed to set active version for enterprise ${enterpriseId}: ${policyErr.message}`,
    );
  }

  return {
    enterpriseId,
    policyVersionId: versionId,
    policySkipped: false,
    rbacSettingsEnsured: true,
  };
}
