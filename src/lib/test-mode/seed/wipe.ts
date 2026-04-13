import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Deletes ALL data for a test enterprise. Used when upgrading from Lite to paid.
 * Deletes in reverse dependency order to respect foreign key constraints.
 * Safety: refuses to wipe non-test enterprises.
 */
export async function wipeTestEnterprise(
  testEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
): Promise<{ success: boolean; error?: string }> {
  const supabase = adminClient || createAdminClient();

  const { data: enterprise } = await supabase
    .from('enterprises')
    .select('is_test_enterprise, test_data_wiped_at')
    .eq('id', testEnterpriseId)
    .single();

  if (!enterprise?.is_test_enterprise) {
    return { success: false, error: 'Cannot wipe a non-test enterprise' };
  }

  if (enterprise.test_data_wiped_at) {
    return { success: true }; // Already wiped — idempotent
  }

  // policy_approval_requests has a rewrite rule (policy_approval_requests_no_delete)
  // that blocks plain DELETEs. Use the SECURITY DEFINER RPC from migration 0056
  // which scopes strictly to is_test_enterprise=true.
  const { error: approvalsErr } = await supabase.rpc(
    'fn_admin_wipe_test_approvals',
    { p_enterprise_id: testEnterpriseId }
  );
  if (approvalsErr) {
    console.error('[wipe] fn_admin_wipe_test_approvals failed', approvalsErr);
  }

  const tables = [
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
    'policy_hard_limits',
    'policy_rules',
    'policy_approval_chains',
    'policy_versions',
    'policy_policies',
    'simulation_runs',
    // treasury_forecasts dropped in migration 0044 (Phase A T20)
    'ai_recommendations',
    // manual_obligations was renamed to obligations in migration 0041
    'obligations',
    'treasury_rules',
    'bridge_transfers',
    'swaps',
    'transfer_attempts',
    'transfers',
    'transactions',
    'bill_payments',
    'invoices',
    'erp_vendors',
    'erp_configurations',
    'fiat_transactions',
    'fiat_payments',
    'bank_accounts',
    'balance_snapshots',
    'wallet_balances',
    'wallets',
  ];

  for (const table of tables) {
    if (table === 'transfer_attempts') {
      const { data: transfers } = await supabase
        .from('transfers')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (transfers?.length) {
        await supabase
          .from('transfer_attempts')
          .delete()
          .in('transfer_id', transfers.map(p => p.id));
      }
      continue;
    }

    if (table === 'erp_vendors') {
      const { data: erps } = await supabase
        .from('erp_configurations')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (erps?.length) {
        await supabase
          .from('erp_vendors')
          .delete()
          .in('erp_config_id', erps.map(e => e.id));
      }
      continue;
    }

    if (table === 'policy_versions') {
      // Null out policy_policies.active_version_id before deleting versions (FK constraint)
      await supabase
        .from('policy_policies')
        .update({ active_version_id: null })
        .eq('enterprise_id', testEnterpriseId);
      // Also null out superseded_by_version_id self-refs
      const { data: vs } = await supabase
        .from('policy_versions').select('id').eq('enterprise_id', testEnterpriseId);
      if (vs?.length) {
        await supabase
          .from('policy_versions')
          .update({ superseded_by_version_id: null })
          .in('id', vs.map(v => v.id));
      }
      await supabase.from('policy_versions').delete().eq('enterprise_id', testEnterpriseId);
      continue;
    }

    await supabase.from(table).delete().eq('enterprise_id', testEnterpriseId);
  }

  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: new Date().toISOString() })
    .eq('id', testEnterpriseId);

  return { success: true };
}
