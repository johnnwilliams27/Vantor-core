/**
 * Multi-tenancy setup script
 *
 * 1. Creates "Test Company" enterprise
 * 2. Backfills all existing data with the enterprise_id
 * 3. Creates app admin user (john@vantor.xyz)
 *
 * Run: npx tsx scripts/setup-multi-tenancy.ts
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADMIN_EMAIL = 'john@vantor.xyz';
const ADMIN_PASSWORD = 'C@repics1990';

const TABLES_WITH_ENTERPRISE_ID = [
  'user_profiles',
  'wallets',
  'wallet_balances',
  'balance_snapshots',
  'erp_configurations',
  'erp_vendors',
  'invoices',
  'payments',
  'payment_attempts',
  'transactions',
  'swaps',
  'gl_postings',
  'bank_accounts',
  'fiat_transactions',
  'treasury_rules',
  'manual_obligations',
  'ai_recommendations',
  'treasury_forecasts',
  'simulation_runs',
  'audit_logs',
  'sanctions_screenings',
  'kyt_transfers',
  'kyt_alerts',
  'travel_rule_transfers',
];

async function main() {
  console.log('=== Multi-tenancy Setup ===\n');

  // 1. Create "Test Company" enterprise
  console.log('1. Creating "Test Company" enterprise...');
  // Check if enterprise already exists
  const { data: existing } = await supabase
    .from('enterprises')
    .select('id')
    .eq('name', 'Test Company')
    .single();

  let enterpriseId: string;
  if (existing) {
    enterpriseId = existing.id;
    console.log(`   Enterprise already exists: ${enterpriseId}`);
  } else {
    const { data: enterprise, error: entErr } = await supabase
      .from('enterprises')
      .insert({ name: 'Test Company', status: 'active', kyc_status: 'verified' })
      .select()
      .single();
    if (entErr || !enterprise) {
      console.error('Failed to create enterprise:', entErr?.message);
      process.exit(1);
    }
    enterpriseId = enterprise.id;
    console.log(`   Created enterprise: ${enterpriseId}`);
  }

  // 2. Backfill enterprise_id on all tables
  console.log('\n2. Backfilling enterprise_id on all tables...');
  for (const table of TABLES_WITH_ENTERPRISE_ID) {
    try {
      // audit_logs has a no-update rule, need special handling
      if (table === 'audit_logs') {
        // We dropped the rule in migration, but if it's been re-added, use rpc
        const { error } = await supabase
          .from(table)
          .update({ enterprise_id: enterpriseId })
          .is('enterprise_id', null);
        if (error) {
          console.log(`   ⚠ ${table}: ${error.message} (may need manual SQL backfill)`);
        } else {
          console.log(`   ✓ ${table}`);
        }
        continue;
      }

      const { error } = await supabase
        .from(table)
        .update({ enterprise_id: enterpriseId })
        .is('enterprise_id', null);

      if (error) {
        console.log(`   ⚠ ${table}: ${error.message}`);
      } else {
        console.log(`   ✓ ${table}`);
      }
    } catch (err) {
      console.log(`   ⚠ ${table}: ${(err as Error).message}`);
    }
  }

  // Also try slack_integrations if it exists
  try {
    const { error } = await supabase
      .from('slack_integrations')
      .update({ enterprise_id: enterpriseId })
      .is('enterprise_id', null);
    if (!error) console.log('   ✓ slack_integrations');
  } catch {
    // table may not exist
  }

  // 3. Create app admin user
  console.log('\n3. Creating app admin user...');

  // Check if user already exists
  const { data: existingUsers } = await supabase
    .from('user_profiles')
    .select('id, email, is_app_admin')
    .eq('email', ADMIN_EMAIL);

  const existingAdmin = existingUsers?.find((u) => u.is_app_admin);

  if (existingAdmin) {
    console.log(`   App admin already exists: ${existingAdmin.id}`);
  } else {
    // Check if the email is already registered as a regular user
    const existingRegular = existingUsers?.find((u) => !u.is_app_admin);

    if (existingRegular) {
      // Update existing user to be app admin (remove enterprise_id)
      const { error } = await supabase
        .from('user_profiles')
        .update({ is_app_admin: true, enterprise_id: null })
        .eq('id', existingRegular.id);

      if (error) {
        console.error('   Failed to promote existing user:', error.message);
      } else {
        console.log(`   Promoted existing user to app admin: ${existingRegular.id}`);
      }
    } else {
      // Create new auth user
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'John Williams' },
      });

      if (authErr) {
        console.error('   Failed to create auth user:', authErr.message);
      } else {
        // Update profile to be app admin
        const { error: profileErr } = await supabase
          .from('user_profiles')
          .update({
            full_name: 'John Williams',
            is_app_admin: true,
            enterprise_id: null,
            onboarding_done: true,
            role: 'treasury_manager',
          })
          .eq('id', authUser.user.id);

        if (profileErr) {
          console.error('   Failed to update profile:', profileErr.message);
        } else {
          console.log(`   Created app admin: ${authUser.user.id}`);
        }
      }
    }
  }

  console.log('\n=== Setup Complete ===');
  console.log(`Enterprise ID: ${enterpriseId}`);
  console.log(`Admin login: ${ADMIN_EMAIL}`);
  console.log('\nRemember to:');
  console.log('1. Run the SQL migration 0010_multi_tenancy.sql in Supabase SQL editor first');
  console.log('2. Add ADMIN_EMAIL env vars to Vercel for production');
}

main().catch(console.error);
