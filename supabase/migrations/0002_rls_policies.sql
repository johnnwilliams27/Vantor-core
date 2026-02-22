-- ============================================================
-- 0002_rls_policies.sql  – Row Level Security
-- ============================================================

-- Enable RLS on every table
ALTER TABLE user_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_balances     ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_configurations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_vendors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE swaps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl_postings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs          ENABLE ROW LEVEL SECURITY;

-- ---- Helper: get calling user's role ----
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- user_profiles
-- ============================================================
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM user_profiles WHERE id = auth.uid()));

-- treasury_manager can see all profiles
CREATE POLICY "Treasury managers can view all profiles"
  ON user_profiles FOR SELECT
  USING (auth_user_role() = 'treasury_manager');

-- ============================================================
-- wallets
-- ============================================================
CREATE POLICY "Own wallets select"
  ON wallets FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Own wallets insert"
  ON wallets FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

CREATE POLICY "Own wallets update"
  ON wallets FOR UPDATE
  USING (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

CREATE POLICY "Own wallets delete"
  ON wallets FOR DELETE
  USING (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

-- ============================================================
-- wallet_balances
-- ============================================================
CREATE POLICY "Select wallet balances"
  ON wallet_balances FOR SELECT
  USING (
    wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid())
  );

-- Only service role (cron) writes balances – no user-level insert/update/delete policies

-- ============================================================
-- balance_snapshots
-- ============================================================
CREATE POLICY "Select balance snapshots"
  ON balance_snapshots FOR SELECT
  USING (
    wallet_id IN (SELECT id FROM wallets WHERE user_id = auth.uid())
  );

-- ============================================================
-- erp_configurations
-- ============================================================
CREATE POLICY "Own ERP config select"
  ON erp_configurations FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Own ERP config insert"
  ON erp_configurations FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

CREATE POLICY "Own ERP config update"
  ON erp_configurations FOR UPDATE
  USING (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

CREATE POLICY "Own ERP config delete"
  ON erp_configurations FOR DELETE
  USING (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

-- ============================================================
-- erp_vendors
-- ============================================================
CREATE POLICY "Select vendors via ERP config"
  ON erp_vendors FOR SELECT
  USING (
    erp_config_id IN (SELECT id FROM erp_configurations WHERE user_id = auth.uid())
  );

CREATE POLICY "Write vendors (accountant+)"
  ON erp_vendors FOR ALL
  USING (
    erp_config_id IN (SELECT id FROM erp_configurations WHERE user_id = auth.uid())
    AND auth_user_role() IN ('treasury_manager', 'accountant')
  );

-- ============================================================
-- invoices
-- ============================================================
CREATE POLICY "Own invoices select"
  ON invoices FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Own invoices insert"
  ON invoices FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

CREATE POLICY "Own invoices update"
  ON invoices FOR UPDATE
  USING (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

CREATE POLICY "Treasury manager delete invoices"
  ON invoices FOR DELETE
  USING (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

-- ============================================================
-- payments
-- ============================================================
CREATE POLICY "Own payments select"
  ON payments FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Treasury manager create payments"
  ON payments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

CREATE POLICY "Treasury manager update payments"
  ON payments FOR UPDATE
  USING (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

CREATE POLICY "Treasury manager cancel payments"
  ON payments FOR DELETE
  USING (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

-- ============================================================
-- payment_attempts
-- ============================================================
CREATE POLICY "Own payment attempts select"
  ON payment_attempts FOR SELECT
  USING (
    payment_id IN (SELECT id FROM payments WHERE user_id = auth.uid())
  );

-- ============================================================
-- transactions
-- ============================================================
CREATE POLICY "Own transactions select"
  ON transactions FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Treasury manager insert transactions"
  ON transactions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

-- ============================================================
-- swaps
-- ============================================================
CREATE POLICY "Own swaps select"
  ON swaps FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Treasury manager create swaps"
  ON swaps FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

CREATE POLICY "Treasury manager update swaps"
  ON swaps FOR UPDATE
  USING (user_id = auth.uid() AND auth_user_role() = 'treasury_manager');

-- ============================================================
-- gl_postings
-- ============================================================
CREATE POLICY "Own GL postings select"
  ON gl_postings FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Accountant+ create GL postings"
  ON gl_postings FOR INSERT
  WITH CHECK (user_id = auth.uid() AND auth_user_role() IN ('treasury_manager', 'accountant'));

-- ============================================================
-- audit_logs
-- ============================================================
CREATE POLICY "Own audit logs select"
  ON audit_logs FOR SELECT USING (user_id = auth.uid() OR auth_user_role() = 'treasury_manager');

-- Only service role inserts audit logs (no user-level insert policy)
-- No update/delete policies → immutable from user perspective
