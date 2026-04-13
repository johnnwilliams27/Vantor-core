import type { SeedContext } from './helpers';
import { daysAgo } from './helpers';

export interface PolicyIds {
  policyId: string;
  v1Id: string;
  v2Id: string;
  v3Id: string;      // active
  chainId: string;   // chain on v3, used by approvals seed
}

export async function seedPolicy(ctx: SeedContext): Promise<PolicyIds | null> {
  const { supabase, enterpriseId, userId } = ctx;

  // 1. Create the policy container
  const { data: policy, error: pErr } = await supabase
    .from('policy_policies')
    .insert({ enterprise_id: enterpriseId, name: 'Standard Policy' })
    .select('id')
    .single();
  if (pErr || !policy) { console.error('[seed:policy] policy insert failed', pErr); return null; }

  // 2. Create 3 versions (v1 and v2 get status='superseded'; v3 gets 'active')
  const versionRows = [
    {
      enterprise_id: enterpriseId, version_number: 1, status: 'superseded',
      name: 'Baseline — Lite defaults', created_by: userId, created_at: daysAgo(60),
      activated_at: daysAgo(55), activated_by: userId, superseded_at: daysAgo(30),
    },
    {
      enterprise_id: enterpriseId, version_number: 2, status: 'superseded',
      name: 'Add $2M daily outflow cap', created_by: userId, created_at: daysAgo(35),
      activated_at: daysAgo(30), activated_by: userId, superseded_at: daysAgo(1),
    },
    {
      enterprise_id: enterpriseId, version_number: 3, status: 'active',
      name: 'SoD for >$500K yield deposits', created_by: userId, created_at: daysAgo(2),
      activated_at: daysAgo(1), activated_by: userId,
    },
  ];
  const { data: versions, error: vErr } = await supabase
    .from('policy_versions').insert(versionRows).select('id, version_number');
  if (vErr || !versions || versions.length !== 3) { console.error('[seed:policy] versions failed', vErr); return null; }
  const v1 = versions.find(v => v.version_number === 1)!.id;
  const v2 = versions.find(v => v.version_number === 2)!.id;
  const v3 = versions.find(v => v.version_number === 3)!.id;

  // 3. Link superseded_by chain (v1 → v2 → v3)
  await supabase.from('policy_versions').update({ superseded_by_version_id: v2 }).eq('id', v1);
  await supabase.from('policy_versions').update({ superseded_by_version_id: v3 }).eq('id', v2);

  // 4. Set active pointer on the policy
  await supabase.from('policy_policies').update({ active_version_id: v3 }).eq('id', policy.id);

  // 5. Approval chains — one 2-slot chain per version. v3's id is returned for approvals seed.
  const chainRows = versions.map(v => ({
    version_id: v.id,
    name: 'Standard 2-approver',
    slots: [
      { slot_index: 0, minimum_role: 'treasury_manager', label: 'Treasury' },
      { slot_index: 1, minimum_role: 'executive', label: 'Executive' },
    ],
    priority: 0,
    expiration_hours: 48,
    created_by: userId,
  }));
  const { data: chains } = await supabase.from('policy_approval_chains').insert(chainRows).select('id, version_id');
  const v3Chain = chains?.find(c => c.version_id === v3)?.id;
  if (!v3Chain) { console.error('[seed:policy] v3 chain missing'); return null; }

  // 6. Hard limits — v1 has one, v2 adds one, v3 inherits v2's set plus one more
  const v1Limits = [
    { version_id: v1, limit_type: 'min_cash_reserve_usd', name: 'Min cash reserve', limit_value: '100000', limit_currency: 'USD', scope: {}, created_by: userId },
  ];
  const v2Limits = [
    { version_id: v2, limit_type: 'min_cash_reserve_usd', name: 'Min cash reserve', limit_value: '100000', limit_currency: 'USD', scope: {}, created_by: userId },
    { version_id: v2, limit_type: 'max_daily_outflow_usd', name: 'Daily outflow cap', limit_value: '2000000', limit_currency: 'USD', scope: {}, created_by: userId },
  ];
  const v3Limits = [
    { version_id: v3, limit_type: 'min_cash_reserve_usd', name: 'Min cash reserve', limit_value: '100000', limit_currency: 'USD', scope: {}, created_by: userId },
    { version_id: v3, limit_type: 'max_daily_outflow_usd', name: 'Daily outflow cap', limit_value: '2000000', limit_currency: 'USD', scope: {}, created_by: userId },
    { version_id: v3, limit_type: 'max_single_asset_concentration_pct', name: 'Single-asset concentration', limit_value: '60', limit_currency: null, scope: {}, created_by: userId },
  ];
  await supabase.from('policy_hard_limits').insert([...v1Limits, ...v2Limits, ...v3Limits]);

  // 7. Rules — one approval_threshold rule per version pointing at that version's chain
  const chainByVersion: Record<string, string> = {};
  chains?.forEach(c => { chainByVersion[c.version_id] = c.id; });
  const ruleRows = [
    {
      version_id: v1, rule_type: 'approval_threshold', name: '>$50K requires 1 approver',
      rationale: 'Baseline Lite default', priority: 0, verdict: 'require_approval',
      verdict_chain_id: chainByVersion[v1], created_by: userId,
      condition: { op: 'gte', lhs: { kind: 'movement_amount_usd' }, rhs: { kind: 'literal', value: 50000 } },
    },
    {
      version_id: v2, rule_type: 'approval_threshold', name: '>$250K cross-chain requires exec',
      rationale: 'Protect cross-chain moves', priority: 0, verdict: 'require_approval',
      verdict_chain_id: chainByVersion[v2], created_by: userId,
      condition: {
        op: 'and', terms: [
          { op: 'gte', lhs: { kind: 'movement_amount_usd' }, rhs: { kind: 'literal', value: 250000 } },
          { op: 'eq', lhs: { kind: 'movement_kind' }, rhs: { kind: 'literal', value: 'bridge' } },
        ],
      },
    },
    {
      version_id: v3, rule_type: 'approval_threshold', name: '>$500K yield deposit requires SoD',
      rationale: 'Separation of duties on large DeFi deposits', priority: 0, verdict: 'require_approval',
      verdict_chain_id: chainByVersion[v3], created_by: userId,
      condition: {
        op: 'and', terms: [
          { op: 'gte', lhs: { kind: 'movement_amount_usd' }, rhs: { kind: 'literal', value: 500000 } },
          { op: 'eq', lhs: { kind: 'movement_kind' }, rhs: { kind: 'literal', value: 'yield_deposit' } },
        ],
      },
    },
  ];
  await supabase.from('policy_rules').insert(ruleRows);

  console.log('[seed:policy] ✓ 1 policy + 3 versions (v3 active) + chains/limits/rules');
  return { policyId: policy.id, v1Id: v1, v2Id: v2, v3Id: v3, chainId: v3Chain };
}
