-- ============================================================
-- 0009_chainalysis_compliance.sql  –  Chainalysis Compliance
-- Sanctions Screening, KYT Transaction Monitoring, Travel Rule
-- ============================================================

-- --------------------------------------------------------
-- New audit_action enum values
-- --------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_sanctions_screen';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_kyt_register';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_kyt_alert';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_travel_rule_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_travel_rule_update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'compliance_override';

-- --------------------------------------------------------
-- New enum types
-- --------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'screening_result') THEN
    CREATE TYPE screening_result AS ENUM ('clear', 'sanctioned', 'partial_match', 'error');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyt_alert_severity') THEN
    CREATE TYPE kyt_alert_severity AS ENUM ('low', 'medium', 'high', 'severe');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyt_alert_status') THEN
    CREATE TYPE kyt_alert_status AS ENUM ('open', 'under_review', 'dismissed', 'escalated', 'resolved');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'travel_rule_status') THEN
    CREATE TYPE travel_rule_status AS ENUM ('pending', 'sent', 'received', 'accepted', 'rejected', 'failed');
  END IF;
END $$;

-- --------------------------------------------------------
-- sanctions_screenings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS sanctions_screenings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  address         TEXT NOT NULL,
  chain           chain_type NOT NULL,
  result          screening_result NOT NULL,
  risk_score      NUMERIC(5,2),
  match_details   JSONB,
  provider        TEXT NOT NULL DEFAULT 'chainalysis',
  entity_type     TEXT,
  entity_id       UUID,
  screened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sanctions_address_chain
  ON sanctions_screenings(address, chain, screened_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanctions_user
  ON sanctions_screenings(user_id, created_at DESC);

ALTER TABLE sanctions_screenings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sanctions_screenings' AND policyname = 'users own sanctions_screenings'
  ) THEN
    CREATE POLICY "users own sanctions_screenings" ON sanctions_screenings FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- --------------------------------------------------------
-- kyt_transfers
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyt_transfers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  external_id           TEXT NOT NULL UNIQUE,
  chain                 chain_type NOT NULL,
  direction             TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  tx_hash               TEXT,
  from_address          TEXT NOT NULL,
  to_address            TEXT NOT NULL,
  token                 token_symbol,
  amount                NUMERIC(36,6),
  asset_amount_usd      NUMERIC(36,2),
  risk_score            NUMERIC(5,2),
  cluster_name          TEXT,
  cluster_category      TEXT,
  raw_response          JSONB,
  payment_id            UUID REFERENCES payments(id) ON DELETE SET NULL,
  transaction_id        UUID REFERENCES transactions(id) ON DELETE SET NULL,
  registered_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyt_transfers_user
  ON kyt_transfers(user_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyt_transfers_tx_hash
  ON kyt_transfers(tx_hash);

ALTER TABLE kyt_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kyt_transfers' AND policyname = 'users own kyt_transfers'
  ) THEN
    CREATE POLICY "users own kyt_transfers" ON kyt_transfers FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- --------------------------------------------------------
-- kyt_alerts
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyt_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  kyt_transfer_id   UUID REFERENCES kyt_transfers(id) ON DELETE SET NULL,
  external_alert_id TEXT,
  severity          kyt_alert_severity NOT NULL,
  status            kyt_alert_status NOT NULL DEFAULT 'open',
  category          TEXT,
  description       TEXT,
  raw_data          JSONB,
  reviewed_by       UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyt_alerts_user_status
  ON kyt_alerts(user_id, status, severity DESC);

ALTER TABLE kyt_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kyt_alerts' AND policyname = 'users own kyt_alerts'
  ) THEN
    CREATE POLICY "users own kyt_alerts" ON kyt_alerts FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- updated_at trigger for kyt_alerts
CREATE TRIGGER set_kyt_alerts_updated_at
  BEFORE UPDATE ON kyt_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --------------------------------------------------------
-- travel_rule_transfers
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS travel_rule_transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  payment_id          UUID REFERENCES payments(id) ON DELETE SET NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  amount_usd          NUMERIC(36,2) NOT NULL,
  originator_name     TEXT,
  originator_address  TEXT,
  originator_wallet   TEXT NOT NULL,
  originator_chain    chain_type NOT NULL,
  originator_vasp     TEXT,
  beneficiary_name    TEXT,
  beneficiary_address TEXT,
  beneficiary_wallet  TEXT NOT NULL,
  beneficiary_chain   chain_type NOT NULL,
  beneficiary_vasp    TEXT,
  status              travel_rule_status NOT NULL DEFAULT 'pending',
  provider_ref        TEXT,
  raw_response        JSONB,
  error_message       TEXT,
  sent_at             TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_travel_rule_user
  ON travel_rule_transfers(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_travel_rule_payment
  ON travel_rule_transfers(payment_id);

ALTER TABLE travel_rule_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'travel_rule_transfers' AND policyname = 'users own travel_rule_transfers'
  ) THEN
    CREATE POLICY "users own travel_rule_transfers" ON travel_rule_transfers FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- updated_at trigger for travel_rule_transfers
CREATE TRIGGER set_travel_rule_transfers_updated_at
  BEFORE UPDATE ON travel_rule_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
