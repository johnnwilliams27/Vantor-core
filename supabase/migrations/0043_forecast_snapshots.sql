-- ============================================================
-- 0043_forecast_snapshots.sql — scenario-aware forecast
-- snapshots linked to a treasury state snapshot, with
-- correlation ID for audit linkage to consuming decisions.
-- ============================================================

-- New audit_action enum value. Added at the top so Postgres'
-- same-transaction restriction (can't USE a new enum value in
-- the same tx that added it) doesn't bite downstream statements.
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'forecast_compute';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forecast_scenario') THEN
    CREATE TYPE forecast_scenario AS ENUM ('base', 'conservative', 'stress', 'custom');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id               UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_by                 UUID REFERENCES user_profiles(id) ON DELETE SET NULL,

  treasury_state_snapshot_id  UUID NOT NULL REFERENCES treasury_state_snapshots(id) ON DELETE CASCADE,
  scenario                    forecast_scenario NOT NULL,
  scenario_params             JSONB NOT NULL DEFAULT '{}'::jsonb,
  window_days                 INT NOT NULL CHECK (window_days BETWEEN 1 AND 365),
  obligation_ids              UUID[] NOT NULL,
  obligation_count            INT NOT NULL,

  -- projection: full ForecastEngine output — timeline, totals, breach markers
  projection                  JSONB NOT NULL,

  -- correlation_id: set by consumers (rule engine, agent) to link this forecast
  -- back to a decision or action they took on the basis of it
  correlation_id              TEXT,
  consumer                    TEXT NOT NULL CHECK (consumer IN
    ('rules_engine', 'agent_planner', 'treasurer_view', 'alert_eval', 'analytics_view')),

  -- Hypothetical forecasts apply pretend actions on top of the real state
  -- snapshot without mutating it. The actions array captures what was applied.
  is_hypothetical             BOOLEAN NOT NULL DEFAULT false,
  hypothetical_actions        JSONB,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_enterprise_computed
  ON forecast_snapshots(enterprise_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_correlation
  ON forecast_snapshots(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_consumer
  ON forecast_snapshots(enterprise_id, consumer, computed_at DESC);

ALTER TABLE forecast_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'forecast_snapshots'
      AND policyname = 'enterprise forecast_snapshots'
  ) THEN
    CREATE POLICY "enterprise forecast_snapshots"
      ON forecast_snapshots
      FOR ALL
      USING (enterprise_id = auth_user_enterprise_id())
      WITH CHECK (enterprise_id = auth_user_enterprise_id());
  END IF;
END $$;

COMMENT ON TABLE forecast_snapshots IS
  'Scenario-aware cash-flow forecasts computed by ForecastEngine (T10). '
  'Links back to the treasury_state_snapshot (0042) it was projected from, '
  'so any forecast can be reproduced from the frozen positions + fx rates.';
