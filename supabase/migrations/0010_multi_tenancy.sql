-- ============================================================
-- 0010: Multi-tenancy — Enterprise/Company data segregation
-- ============================================================

-- 1. Enterprise status enum
DO $$ BEGIN
  CREATE TYPE enterprise_status AS ENUM ('active', 'frozen', 'suspended', 'pending_kyc');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Enterprises table
CREATE TABLE IF NOT EXISTS enterprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status enterprise_status NOT NULL DEFAULT 'active',
  kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'verified', 'rejected')),
  kyc_submitted_at TIMESTAMPTZ,
  kyc_verified_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE enterprises ENABLE ROW LEVEL SECURITY;

-- 3. Add enterprise_id and is_app_admin to user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE SET NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_app_admin BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_user_profiles_enterprise ON user_profiles(enterprise_id);

-- 4. Add enterprise_id to all data tables
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_wallets_enterprise ON wallets(enterprise_id);

ALTER TABLE wallet_balances ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_wallet_balances_enterprise ON wallet_balances(enterprise_id);

ALTER TABLE balance_snapshots ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_enterprise ON balance_snapshots(enterprise_id);

ALTER TABLE erp_configurations ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_erp_configurations_enterprise ON erp_configurations(enterprise_id);

ALTER TABLE erp_vendors ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_erp_vendors_enterprise ON erp_vendors(enterprise_id);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_invoices_enterprise ON invoices(enterprise_id);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_payments_enterprise ON payments(enterprise_id);

ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_enterprise ON payment_attempts(enterprise_id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_transactions_enterprise ON transactions(enterprise_id);

ALTER TABLE swaps ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_swaps_enterprise ON swaps(enterprise_id);

ALTER TABLE gl_postings ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_gl_postings_enterprise ON gl_postings(enterprise_id);

ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_bank_accounts_enterprise ON bank_accounts(enterprise_id);

ALTER TABLE fiat_transactions ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_fiat_transactions_enterprise ON fiat_transactions(enterprise_id);

ALTER TABLE treasury_rules ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_treasury_rules_enterprise ON treasury_rules(enterprise_id);

ALTER TABLE manual_obligations ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_manual_obligations_enterprise ON manual_obligations(enterprise_id);

ALTER TABLE ai_recommendations ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_enterprise ON ai_recommendations(enterprise_id);

ALTER TABLE treasury_forecasts ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_treasury_forecasts_enterprise ON treasury_forecasts(enterprise_id);

ALTER TABLE simulation_runs ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_simulation_runs_enterprise ON simulation_runs(enterprise_id);

ALTER TABLE sanctions_screenings ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_sanctions_screenings_enterprise ON sanctions_screenings(enterprise_id);

ALTER TABLE kyt_transfers ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_kyt_transfers_enterprise ON kyt_transfers(enterprise_id);

ALTER TABLE kyt_alerts ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_kyt_alerts_enterprise ON kyt_alerts(enterprise_id);

ALTER TABLE travel_rule_transfers ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_travel_rule_transfers_enterprise ON travel_rule_transfers(enterprise_id);

-- audit_logs: temporarily allow updates for backfill, then re-lock
DROP RULE IF EXISTS no_update_audit_logs ON audit_logs;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_audit_logs_enterprise ON audit_logs(enterprise_id);

-- Slack integrations
DO $$ BEGIN
  ALTER TABLE slack_integrations ADD COLUMN IF NOT EXISTS enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE;
  CREATE INDEX IF NOT EXISTS idx_slack_integrations_enterprise ON slack_integrations(enterprise_id);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- 5. New audit actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enterprise_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enterprise_update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enterprise_freeze';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enterprise_unfreeze';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'admin_view_audit';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'admin_view_enterprise';

-- 6. Helper functions for RLS
CREATE OR REPLACE FUNCTION auth_user_enterprise_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT enterprise_id FROM user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION auth_is_app_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(is_app_admin, false) FROM user_profiles WHERE id = auth.uid();
$$;

-- 7. Updated_at trigger for enterprises
CREATE OR REPLACE TRIGGER set_enterprises_updated_at
  BEFORE UPDATE ON enterprises
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 8. Re-lock audit_logs
CREATE RULE no_update_audit_logs AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
