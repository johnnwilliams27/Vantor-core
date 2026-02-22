-- Migration: 0004_banking.sql
-- Bank accounts + fiat on-ramp/off-ramp tables

-- New audit actions
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bank_account_connect';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bank_account_disconnect';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'onramp_execute';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'offramp_execute';

-- Bank accounts
CREATE TABLE IF NOT EXISTS bank_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  plaid_item_id       TEXT,
  plaid_account_id    TEXT,
  institution_name    TEXT NOT NULL,
  account_name        TEXT NOT NULL,
  account_type        TEXT NOT NULL DEFAULT 'checking',
  last4               TEXT,
  routing_number      TEXT,
  currency            TEXT NOT NULL DEFAULT 'USD',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id);

-- Fiat transactions (ramp history)
CREATE TABLE IF NOT EXISTS fiat_transactions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  bank_account_id         UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  direction               TEXT NOT NULL CHECK (direction IN ('onramp','offramp')),
  crypto_amount           NUMERIC(36,6) NOT NULL,
  crypto_token            TEXT NOT NULL,
  fiat_amount             NUMERIC(36,2) NOT NULL,
  fiat_currency           TEXT NOT NULL DEFAULT 'USD',
  exchange_rate           NUMERIC(18,8),
  fee_amount              NUMERIC(36,2),
  status                  TEXT NOT NULL DEFAULT 'pending',
  provider                TEXT NOT NULL DEFAULT 'bridge',
  provider_transaction_id TEXT,
  settled_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fiat_tx_user ON fiat_transactions(user_id, created_at DESC);

-- RLS
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiat_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own bank_accounts" ON bank_accounts FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own fiat_transactions" ON fiat_transactions FOR ALL USING (user_id = auth.uid());
