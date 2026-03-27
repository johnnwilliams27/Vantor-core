-- ============================================================
-- 0001_init_schema.sql  – Core schema for Crypto Treasury
-- ============================================================

-- ---------- Enums ----------
CREATE TYPE user_role AS ENUM ('treasury_manager', 'accountant', 'auditor');
CREATE TYPE chain_type AS ENUM ('ethereum', 'solana');
CREATE TYPE token_symbol AS ENUM ('USDC', 'USDT', 'PYUSD');  -- NOTE: PYUSD removed in 0017_remove_pyusd.sql
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE invoice_status AS ENUM ('unpaid', 'paid', 'partially_paid', 'overdue', 'cancelled');
CREATE TYPE erp_provider AS ENUM ('sap', 'oracle');
CREATE TYPE audit_action AS ENUM (
  'login', 'logout',
  'payment_create', 'payment_execute', 'payment_cancel', 'payment_schedule',
  'invoice_create', 'invoice_update', 'invoice_sync', 'invoice_link_tx',
  'swap_quote', 'swap_execute',
  'wallet_connect', 'wallet_disconnect',
  'erp_connect', 'erp_sync',
  'gl_post',
  'settings_update'
);

-- ---------- User Profiles ----------
CREATE TABLE user_profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT,
  role          user_role NOT NULL DEFAULT 'auditor',
  onboarding_done BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Wallets ----------
CREATE TABLE wallets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  chain         chain_type NOT NULL,
  address       TEXT NOT NULL,
  label         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, chain, address)
);

-- ---------- Wallet Balances (cached) ----------
CREATE TABLE wallet_balances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token         token_symbol NOT NULL,
  balance       NUMERIC(36, 6) NOT NULL DEFAULT 0,
  usd_value     NUMERIC(36, 2),
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(wallet_id, token)
);

-- ---------- Balance Snapshots (historical) ----------
CREATE TABLE balance_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id     UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  token         token_symbol NOT NULL,
  balance       NUMERIC(36, 6) NOT NULL,
  usd_value     NUMERIC(36, 2),
  snapped_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_snapshots_wallet_token_time
  ON balance_snapshots(wallet_id, token, snapped_at DESC);

-- ---------- ERP Configurations ----------
CREATE TABLE erp_configurations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  provider      erp_provider NOT NULL,
  label         TEXT NOT NULL DEFAULT 'Default',
  credentials   TEXT NOT NULL,   -- AES-256-GCM encrypted JSON
  is_active     BOOLEAN NOT NULL DEFAULT false,
  last_synced   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

-- ---------- ERP Vendors ----------
CREATE TABLE erp_vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_config_id UUID NOT NULL REFERENCES erp_configurations(id) ON DELETE CASCADE,
  external_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT,
  wallet_address TEXT,
  chain         chain_type,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(erp_config_id, external_id)
);

-- ---------- Invoices ----------
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  erp_config_id   UUID REFERENCES erp_configurations(id),
  erp_invoice_id  TEXT,
  vendor_id       UUID REFERENCES erp_vendors(id),
  invoice_number  TEXT NOT NULL,
  description     TEXT,
  amount          NUMERIC(36, 6) NOT NULL,
  token           token_symbol NOT NULL,
  chain           chain_type NOT NULL,
  status          invoice_status NOT NULL DEFAULT 'unpaid',
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  linked_tx_id    UUID,   -- FK added after transactions table
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_user_status ON invoices(user_id, status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);

-- ---------- Payments ----------
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  invoice_id      UUID REFERENCES invoices(id),
  from_wallet_id  UUID NOT NULL REFERENCES wallets(id),
  to_address      TEXT NOT NULL,
  chain           chain_type NOT NULL,
  token           token_symbol NOT NULL,
  amount          NUMERIC(36, 6) NOT NULL,
  status          payment_status NOT NULL DEFAULT 'pending',
  scheduled_for   TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ,
  tx_hash         TEXT,
  error_message   TEXT,
  memo            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_user_status ON payments(user_id, status);
CREATE INDEX idx_payments_scheduled ON payments(status, scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

-- ---------- Payment Attempts ----------
CREATE TABLE payment_attempts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  attempt_no  INT NOT NULL DEFAULT 1,
  status      payment_status NOT NULL,
  tx_hash     TEXT,
  error       TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Transactions ----------
CREATE TABLE transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  wallet_id     UUID REFERENCES wallets(id),
  chain         chain_type NOT NULL,
  tx_hash       TEXT NOT NULL,
  block_number  BIGINT,
  from_address  TEXT NOT NULL,
  to_address    TEXT NOT NULL,
  token         token_symbol,
  amount        NUMERIC(36, 6),
  fee           NUMERIC(36, 9),
  status        TEXT NOT NULL DEFAULT 'confirmed',
  direction     TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  timestamp     TIMESTAMPTZ NOT NULL,
  raw_data      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(chain, tx_hash)
);

CREATE INDEX idx_transactions_user ON transactions(user_id, timestamp DESC);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id, timestamp DESC);

-- Link invoices.linked_tx_id → transactions
ALTER TABLE invoices
  ADD CONSTRAINT fk_invoices_tx
  FOREIGN KEY (linked_tx_id) REFERENCES transactions(id);

-- ---------- Swaps ----------
CREATE TABLE swaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  wallet_id       UUID NOT NULL REFERENCES wallets(id),
  chain           chain_type NOT NULL,
  from_token      token_symbol NOT NULL,
  to_token        token_symbol NOT NULL,
  from_amount     NUMERIC(36, 6) NOT NULL,
  to_amount       NUMERIC(36, 6),
  rate            NUMERIC(20, 8),
  slippage_bps    INT,
  tx_hash         TEXT,
  status          payment_status NOT NULL DEFAULT 'pending',
  quote_data      JSONB,
  executed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- GL Postings ----------
CREATE TABLE gl_postings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  erp_config_id   UUID NOT NULL REFERENCES erp_configurations(id),
  invoice_id      UUID REFERENCES invoices(id),
  payment_id      UUID REFERENCES payments(id),
  external_gl_id  TEXT,
  amount          NUMERIC(36, 6) NOT NULL,
  token           token_symbol NOT NULL,
  gl_account      TEXT NOT NULL,
  posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'posted',
  response_data   JSONB
);

-- ---------- Audit Logs ----------
CREATE TABLE audit_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  action      audit_action NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  details     JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);

-- Prevent DELETE on audit_logs (enforce immutability via RLS)
CREATE RULE no_delete_audit_logs AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_update_audit_logs AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;

-- ---------- Updated-at triggers ----------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_erp_config_updated_at
  BEFORE UPDATE ON erp_configurations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Auto-create user_profile on signup ----------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO user_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
