-- Treasury AI Phase 2: Price Oracle, Cash Flow Predictions, Paper Trading, Reports
-- Run this migration manually in the Supabase SQL editor

-- ============================================================
-- New audit_action enum values
-- ============================================================
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_forecast_generate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_simulation_run';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_report_export';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_price_refresh';

-- ============================================================
-- treasury_forecasts table
-- One row per (user_id, lookahead_days) — upserted on re-generate
-- ============================================================
CREATE TABLE IF NOT EXISTS treasury_forecasts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  lookahead_days INT NOT NULL DEFAULT 30,
  forecast_data  JSONB NOT NULL DEFAULT '[]',
  ai_summary     TEXT,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lookahead_days)
);

CREATE INDEX IF NOT EXISTS idx_treasury_forecasts_user
  ON treasury_forecasts(user_id, generated_at DESC);

ALTER TABLE treasury_forecasts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users own treasury_forecasts"
    ON treasury_forecasts FOR ALL
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- simulation_runs table
-- Immutable per run — no UNIQUE constraint
-- ============================================================
CREATE TABLE IF NOT EXISTS simulation_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  rule_snapshot JSONB NOT NULL DEFAULT '{}',
  results       JSONB NOT NULL DEFAULT '[]',
  summary       JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_user
  ON simulation_runs(user_id, created_at DESC);

ALTER TABLE simulation_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "users own simulation_runs"
    ON simulation_runs FOR ALL
    USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
