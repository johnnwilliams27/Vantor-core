import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Deletes ALL data for a test enterprise. Used when upgrading from Lite to paid,
 * and from the admin "reset test data" action.
 *
 * Every DELETE here throws on error so a partial wipe fails loudly instead of
 * leaking rows into the next reseed (see 2026-04-13 seed audit — silent
 * enterprise_id-scoped deletes against version_id-scoped child tables were
 * the root cause of the `policy_*` drift on prod).
 */
export async function wipeTestEnterprise(
  testEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<{ success: boolean; error?: string }> {
  const supabase = adminClient || createAdminClient();

  const { data: enterprise } = await supabase
    .from('enterprises')
    .select('is_test_enterprise')
    .eq('id', testEnterpriseId)
    .single();

  if (!enterprise?.is_test_enterprise) {
    return { success: false, error: 'Cannot wipe a non-test enterprise' };
  }

  // Note: `test_data_wiped_at` is intentionally NOT used as an idempotency
  // short-circuit. A reseed after a prior wipe must still re-wipe to clear
  // any rows inserted between wipes (e.g. runtime audit_logs, insights,
  // treasury_state_snapshots). The column is now a last-wiped-at timestamp
  // for observability only.

  try {
    // policy_approval_requests has a rewrite rule (policy_approval_requests_no_delete)
    // that blocks plain DELETEs. Use the SECURITY DEFINER RPC from migration 0056
    // which scopes strictly to is_test_enterprise=true.
    {
      const { error } = await supabase.rpc(
        'fn_admin_wipe_test_approvals',
        { p_enterprise_id: testEnterpriseId }
      );
      if (error) throw new Error(`fn_admin_wipe_test_approvals failed: ${error.message}`);
    }

    // --- Policy children: scoped by version_id, not enterprise_id ---------
    // Resolve the set of policy versions for this enterprise, then delete
    // hard_limits / rules / approval_chains via FK.
    const { data: vs, error: vsErr } = await supabase
      .from('policy_versions')
      .select('id')
      .eq('enterprise_id', testEnterpriseId);
    if (vsErr) throw new Error(`policy_versions lookup failed: ${vsErr.message}`);
    const versionIds = (vs ?? []).map((v) => v.id);

    if (versionIds.length > 0) {
      for (const child of ['policy_hard_limits', 'policy_rules', 'policy_approval_chains'] as const) {
        const { error } = await supabase.from(child).delete().in('version_id', versionIds);
        if (error) throw new Error(`${child} delete failed: ${error.message}`);
      }
    }

    // Null out FK cycles so policy_versions can delete.
    {
      const { error } = await supabase
        .from('policy_policies')
        .update({ active_version_id: null })
        .eq('enterprise_id', testEnterpriseId);
      if (error) throw new Error(`policy_policies.active_version_id reset failed: ${error.message}`);
    }
    if (versionIds.length > 0) {
      const { error } = await supabase
        .from('policy_versions')
        .update({ superseded_by_version_id: null })
        .in('id', versionIds);
      if (error) throw new Error(`policy_versions.superseded_by reset failed: ${error.message}`);
    }

    // Enterprise-scoped deletes (ordered to respect remaining FKs).
    const enterpriseScopedTables = [
      'notifications',
      'audit_logs',
      'travel_rule_transfers',
      'kyt_alerts',
      'kyt_transfers',
      'sanctions_screenings',
      'yield_transactions',
      'yield_positions',
      'treasury_insights',
      'analytics_pin_preferences',
      'treasury_state_snapshots',
      'policy_versions',
      'policy_policies',
      'simulation_runs',
      'ai_recommendations',
      'obligations',
      'treasury_rules',
      'bridge_transfers',
      'swaps',
      // transfer_attempts scoped by transfer_id → handled below before transfers
      'transfers',
      'transactions',
      'bill_payments',
      'invoices',
      // erp_vendors scoped by erp_config_id → handled below before erp_configurations
      'erp_configurations',
      'fiat_transactions',
      'fiat_payments',
      'bank_accounts',
      'balance_snapshots',
      'wallet_balances',
      'wallets',
    ];

    // transfer_attempts: scoped via transfers.id IN (...)
    {
      const { data: transfers, error } = await supabase
        .from('transfers')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (error) throw new Error(`transfers lookup failed: ${error.message}`);
      if (transfers?.length) {
        const { error: delErr } = await supabase
          .from('transfer_attempts')
          .delete()
          .in('transfer_id', transfers.map((p) => p.id));
        if (delErr) throw new Error(`transfer_attempts delete failed: ${delErr.message}`);
      }
    }

    // erp_vendors: scoped via erp_configurations.id IN (...)
    {
      const { data: erps, error } = await supabase
        .from('erp_configurations')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (error) throw new Error(`erp_configurations lookup failed: ${error.message}`);
      if (erps?.length) {
        const { error: delErr } = await supabase
          .from('erp_vendors')
          .delete()
          .in('erp_config_id', erps.map((e) => e.id));
        if (delErr) throw new Error(`erp_vendors delete failed: ${delErr.message}`);
      }
    }

    for (const table of enterpriseScopedTables) {
      const { error } = await supabase.from(table).delete().eq('enterprise_id', testEnterpriseId);
      if (error) throw new Error(`${table} delete failed: ${error.message}`);
    }

    const { error: stampErr } = await supabase
      .from('enterprises')
      .update({ test_data_wiped_at: new Date().toISOString() })
      .eq('id', testEnterpriseId);
    if (stampErr) throw new Error(`test_data_wiped_at stamp failed: ${stampErr.message}`);

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[wipe] aborted:', msg);
    return { success: false, error: msg };
  }
}
