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

  const tables = [
    'audit_logs',
    'travel_rule_transfers',
    'kyt_alerts',
    'kyt_transfers',
    'sanctions_screenings',
    'yield_transactions',
    'yield_positions',
    'simulation_runs',
    'treasury_forecasts',
    'ai_recommendations',
    'manual_obligations',
    'treasury_rules',
    'bridge_transfers',
    'swaps',
    'payment_attempts',
    'payments',
    'transactions',
    'gl_postings',
    'invoices',
    'erp_vendors',
    'erp_configurations',
    'fiat_transactions',
    'bank_accounts',
    'balance_snapshots',
    'wallet_balances',
    'wallets',
  ];

  for (const table of tables) {
    if (table === 'payment_attempts') {
      const { data: payments } = await supabase
        .from('payments')
        .select('id')
        .eq('enterprise_id', testEnterpriseId);
      if (payments?.length) {
        await supabase
          .from('payment_attempts')
          .delete()
          .in('payment_id', payments.map(p => p.id));
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

    await supabase.from(table).delete().eq('enterprise_id', testEnterpriseId);
  }

  await supabase
    .from('enterprises')
    .update({ test_data_wiped_at: new Date().toISOString() })
    .eq('id', testEnterpriseId);

  return { success: true };
}
