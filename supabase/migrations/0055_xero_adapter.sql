-- 0055_xero_adapter.sql
-- Xero real adapter: drop dormant gl_postings, create bill_payments,
-- add Xero-specific columns to erp_configurations.

-- Drop dormant gl_postings table (and its indexes/policies).
DROP TABLE IF EXISTS gl_postings CASCADE;

-- Add Xero-specific columns to erp_configurations.
ALTER TABLE erp_configurations
  ADD COLUMN IF NOT EXISTS xero_tenant_id             TEXT,
  ADD COLUMN IF NOT EXISTS xero_bank_account_id       TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_rotated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status                     TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'needs_reconnect'));

CREATE INDEX IF NOT EXISTS idx_erp_configurations_status
  ON erp_configurations(status)
  WHERE status != 'active';

-- New bill_payments table replacing gl_postings.
CREATE TABLE IF NOT EXISTS bill_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id        UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  erp_config_id        UUID NOT NULL REFERENCES erp_configurations(id) ON DELETE CASCADE,
  invoice_id           TEXT NOT NULL,             -- ERP-side, not a Vantor UUID
  external_payment_id  TEXT,                      -- ERP-side payment ID
  external_tx_hash     TEXT NOT NULL,             -- on-chain tx hash
  amount               NUMERIC(36, 6) NOT NULL,
  currency             TEXT NOT NULL,             -- ISO 4217
  payment_date         DATE NOT NULL,
  reference            TEXT,
  status               TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'failed')),
  response_data        JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bill_payments_user         ON bill_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_enterprise   ON bill_payments(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_erp_config   ON bill_payments(erp_config_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_tx_hash      ON bill_payments(external_tx_hash);

-- RLS: mirror the erp_configurations policies (user + enterprise scoping).
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bill_payments_user_read ON bill_payments;
CREATE POLICY bill_payments_user_read
  ON bill_payments FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS bill_payments_user_insert ON bill_payments;
CREATE POLICY bill_payments_user_insert
  ON bill_payments FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS bill_payments_user_update ON bill_payments;
CREATE POLICY bill_payments_user_update
  ON bill_payments FOR UPDATE
  USING (user_id = auth.uid());

-- Table for CI live test refresh token bootstrap (see Phase 9).
CREATE TABLE IF NOT EXISTS xero_ci_bootstrap (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  refresh_token  TEXT NOT NULL,
  rotated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT xero_ci_bootstrap_singleton CHECK (id = 1)
);
