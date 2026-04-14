import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Deletes ALL data for a test enterprise. Used when upgrading from Lite to paid,
 * and from the admin "reset test data" action.
 *
 * Every DELETE throws on error so a partial wipe fails loudly instead of
 * leaking rows into the next reseed (see 2026-04-13 seed audit). The order
 * below is a strict FK-safe topological sort: children before targets.
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
  // any rows inserted between wipes. The column is now a last-wiped-at
  // timestamp for observability only.

  // Helper: enterprise_id-scoped delete with error throw.
  const del = async (table: string): Promise<void> => {
    const { error } = await supabase.from(table).delete().eq('enterprise_id', testEnterpriseId);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);
  };

  try {
    // --- Privileged RPC wipes for rule-protected tables ---------------------
    // policy_approval_requests: _no_delete rule (migration 0038 → 0056 RPC)
    {
      const { error } = await supabase.rpc('fn_admin_wipe_test_approvals', { p_enterprise_id: testEnterpriseId });
      if (error) throw new Error(`fn_admin_wipe_test_approvals failed: ${error.message}`);
    }
    // policy tree: BEFORE UPDATE/DELETE triggers refuse non-draft parents (0038 → 0057 RPC)
    {
      const { error } = await supabase.rpc('fn_admin_wipe_test_policy', { p_enterprise_id: testEnterpriseId });
      if (error) throw new Error(`fn_admin_wipe_test_policy failed: ${error.message}`);
    }

    // --- Topologically-ordered plain DELETEs --------------------------------
    // Rule: every table listed must have ALL tables that FK into it listed
    // earlier. Any time a migration adds a new FK, update this order.

    // Standalone / leaf tables (no FKs back)
    await del('notifications');
    await del('audit_logs');
    await del('travel_rule_transfers');

    // Compliance: kyt_alerts → kyt_transfers
    await del('kyt_alerts');
    await del('kyt_transfers');
    await del('sanctions_screenings');

    // Yield: yield_transactions → yield_positions (→ wallets, deleted last)
    await del('yield_transactions');
    await del('yield_positions');

    // Analytics / insights (standalone by enterprise_id)
    await del('treasury_insights');
    await del('analytics_pin_preferences');
    await del('treasury_state_snapshots');

    // Treasury (standalone)
    await del('simulation_runs');
    await del('ai_recommendations');
    await del('obligations');
    await del('treasury_rules');

    // Movement: transfer_attempts → transfers (via transfer_id lookup)
    {
      const { data: transfers, error } = await supabase
        .from('transfers').select('id').eq('enterprise_id', testEnterpriseId);
      if (error) throw new Error(`transfers lookup failed: ${error.message}`);
      if (transfers?.length) {
        const { error: delErr } = await supabase
          .from('transfer_attempts').delete().in('transfer_id', transfers.map((t) => t.id));
        if (delErr) throw new Error(`transfer_attempts delete failed: ${delErr.message}`);
      }
    }
    await del('transfers');
    await del('bridge_transfers');
    await del('swaps');
    await del('transactions');

    // ERP chain: bill_payments → invoices → erp_vendors → erp_configurations
    await del('bill_payments');
    await del('invoices');
    {
      const { data: erps, error } = await supabase
        .from('erp_configurations').select('id').eq('enterprise_id', testEnterpriseId);
      if (error) throw new Error(`erp_configurations lookup failed: ${error.message}`);
      if (erps?.length) {
        const { error: delErr } = await supabase
          .from('erp_vendors').delete().in('erp_config_id', erps.map((e) => e.id));
        if (delErr) throw new Error(`erp_vendors delete failed: ${delErr.message}`);
      }
    }
    await del('erp_configurations');

    // Banking: fiat → bank_accounts
    await del('fiat_transactions');
    await del('fiat_payments');
    await del('bank_accounts');

    // Wallets chain: balance_snapshots + wallet_balances → wallets
    await del('balance_snapshots');
    await del('wallet_balances');
    await del('wallets');

    // Stamp observability timestamp.
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
