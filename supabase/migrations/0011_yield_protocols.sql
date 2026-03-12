-- ============================================================
-- 0011_yield_protocols.sql  –  Yield Protocol Integrations
-- Aave V3, Morpho, Kamino, Ondo (USDY)
-- ============================================================

-- --------------------------------------------------------
-- New audit_action enum values
-- --------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_deposit';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_withdraw';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'yield_position_refresh';

-- --------------------------------------------------------
-- New enum types
-- --------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'yield_protocol_id') THEN
    CREATE TYPE yield_protocol_id AS ENUM ('aave_v3', 'morpho', 'kamino', 'ondo');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'yield_tx_type') THEN
    CREATE TYPE yield_tx_type AS ENUM ('deposit', 'withdraw');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'yield_tx_status') THEN
    CREATE TYPE yield_tx_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
  END IF;
END $$;

-- --------------------------------------------------------
-- yield_positions  –  tracks active yield positions
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS yield_positions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id     UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  wallet_id         UUID REFERENCES wallets(id) ON DELETE SET NULL,
  protocol          yield_protocol_id NOT NULL,
  chain             chain_type NOT NULL,
  underlying_token  token_symbol NOT NULL,
  yield_token       TEXT NOT NULL,
  deposited_amount  NUMERIC(36,6) NOT NULL DEFAULT 0,
  current_value_usd NUMERIC(36,2) NOT NULL DEFAULT 0,
  accrued_yield_usd NUMERIC(36,2) NOT NULL DEFAULT 0,
  apy_snapshot      NUMERIC(8,4),
  last_refreshed_at TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  metadata          JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yield_positions_enterprise
  ON yield_positions(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_yield_positions_user_protocol
  ON yield_positions(user_id, protocol, is_active);
CREATE INDEX IF NOT EXISTS idx_yield_positions_wallet
  ON yield_positions(wallet_id);

ALTER TABLE yield_positions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'yield_positions' AND policyname = 'users own yield_positions'
  ) THEN
    CREATE POLICY "users own yield_positions" ON yield_positions FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

CREATE TRIGGER set_yield_positions_updated_at
  BEFORE UPDATE ON yield_positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------
-- yield_transactions  –  deposit / withdraw history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS yield_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id     UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  position_id       UUID REFERENCES yield_positions(id) ON DELETE SET NULL,
  protocol          yield_protocol_id NOT NULL,
  chain             chain_type NOT NULL,
  tx_type           yield_tx_type NOT NULL,
  underlying_token  token_symbol NOT NULL,
  amount            NUMERIC(36,6) NOT NULL,
  amount_usd        NUMERIC(36,2),
  tx_hash           TEXT,
  status            yield_tx_status NOT NULL DEFAULT 'pending',
  error_message     TEXT,
  executed_at       TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_yield_tx_enterprise
  ON yield_transactions(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_yield_tx_user
  ON yield_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_yield_tx_position
  ON yield_transactions(position_id);

ALTER TABLE yield_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'yield_transactions' AND policyname = 'users own yield_transactions'
  ) THEN
    CREATE POLICY "users own yield_transactions" ON yield_transactions FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

CREATE TRIGGER set_yield_transactions_updated_at
  BEFORE UPDATE ON yield_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
