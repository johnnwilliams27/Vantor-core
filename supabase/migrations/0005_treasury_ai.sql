-- ============================================================
-- 0005_treasury_ai.sql  –  Treasury AI Phase 1
-- ============================================================

-- --------------------------------------------------------
-- New audit_action enum values
-- --------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_rule_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_rule_update';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_obligation_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_obligation_delete';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_recommendation_generate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_recommendation_approve';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_recommendation_reject';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_recommendation_execute';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'bank_balance_refresh';

-- --------------------------------------------------------
-- New columns on bank_accounts
-- --------------------------------------------------------
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS current_balance   NUMERIC(36,2),
  ADD COLUMN IF NOT EXISTS balance_currency  TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS balance_as_of     TIMESTAMPTZ;

-- --------------------------------------------------------
-- treasury_rules
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS treasury_rules (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  label                    TEXT NOT NULL DEFAULT 'Default Rule',
  is_active                BOOLEAN NOT NULL DEFAULT true,
  safety_buffer_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1.5,
  obligation_lookahead_days INT NOT NULL DEFAULT 7,
  target_stablecoin        TEXT NOT NULL DEFAULT 'USDC',
  target_chain             TEXT NOT NULL DEFAULT 'ethereum',
  approval_threshold_usd   NUMERIC(36,2) NOT NULL DEFAULT 100000,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_rules_user ON treasury_rules(user_id, is_active);

ALTER TABLE treasury_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'treasury_rules' AND policyname = 'users own treasury_rules'
  ) THEN
    CREATE POLICY "users own treasury_rules" ON treasury_rules FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- --------------------------------------------------------
-- manual_obligations
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS manual_obligations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  description     TEXT,
  amount_usd      NUMERIC(36,2) NOT NULL,
  due_date        DATE NOT NULL,
  is_recurring    BOOLEAN NOT NULL DEFAULT false,
  recurrence_days INT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_obligations_user_due
  ON manual_obligations(user_id, due_date) WHERE is_active = true;

ALTER TABLE manual_obligations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'manual_obligations' AND policyname = 'users own manual_obligations'
  ) THEN
    CREATE POLICY "users own manual_obligations" ON manual_obligations FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;

-- --------------------------------------------------------
-- ai_recommendations
-- --------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recommendation_status') THEN
    CREATE TYPE recommendation_status AS ENUM
      ('pending_approval','approved','rejected','executed','expired','auto_executed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recommendation_action') THEN
    CREATE TYPE recommendation_action AS ENUM ('onramp','offramp','no_action');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  treasury_rule_id          UUID REFERENCES treasury_rules(id) ON DELETE SET NULL,
  total_bank_balance_usd    NUMERIC(36,2) NOT NULL,
  total_crypto_balance_usd  NUMERIC(36,2) NOT NULL,
  obligations_in_window_usd NUMERIC(36,2) NOT NULL,
  safety_buffer_target_usd  NUMERIC(36,2) NOT NULL,
  obligation_lookahead_days INT NOT NULL,
  action                    recommendation_action NOT NULL,
  recommended_amount_usd    NUMERIC(36,2),
  bank_account_id           UUID REFERENCES bank_accounts(id) ON DELETE SET NULL,
  stablecoin_token          TEXT,
  stablecoin_chain          TEXT,
  ai_reasoning              TEXT NOT NULL,
  ai_model                  TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  status                    recommendation_status NOT NULL DEFAULT 'pending_approval',
  requires_approval         BOOLEAN NOT NULL DEFAULT true,
  approved_by               UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_at               TIMESTAMPTZ,
  rejected_by               UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  rejected_at               TIMESTAMPTZ,
  rejection_reason          TEXT,
  executed_at               TIMESTAMPTZ,
  fiat_transaction_id       UUID REFERENCES fiat_transactions(id) ON DELETE SET NULL,
  execution_error           TEXT,
  expires_at                TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_recs_user_status
  ON ai_recommendations(user_id, status, created_at DESC);

ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_recommendations' AND policyname = 'users own ai_recommendations'
  ) THEN
    CREATE POLICY "users own ai_recommendations" ON ai_recommendations FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;
