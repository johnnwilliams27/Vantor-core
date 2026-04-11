-- ============================================================
-- 0037_treasury_state_snapshots.sql — persisted point-in-time
-- aggregate of an enterprise's full treasury across fiat, crypto,
-- and DeFi, with FX rates captured for reproducibility.
-- ============================================================

-- New audit_action enum value. Must run in its own transaction
-- (Postgres forbids using a new enum value in the same tx it's added).
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'treasury_snapshot_create';

CREATE TABLE IF NOT EXISTS treasury_state_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id   UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  taken_by        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  trigger         TEXT NOT NULL CHECK (trigger IN ('scheduled', 'on_demand', 'pre_decision', 'pre_action')),
  base_currency   TEXT NOT NULL DEFAULT 'USD',

  total_value_base_usd       NUMERIC(36,2) NOT NULL,
  total_fiat_base_usd        NUMERIC(36,2) NOT NULL,
  total_stablecoin_base_usd  NUMERIC(36,2) NOT NULL,
  total_defi_base_usd        NUMERIC(36,2) NOT NULL,

  -- positions: array of per-asset rows { assetSymbol, chain, venueKind, venueId, amount, unitPriceUsd, valueUsd }
  -- fx_rates: { "USD/EUR": 0.92, ... } — captured at snapshot time for reproducibility
  positions JSONB NOT NULL,
  fx_rates  JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_snapshots_enterprise_taken
  ON treasury_state_snapshots(enterprise_id, taken_at DESC);

ALTER TABLE treasury_state_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'treasury_state_snapshots'
      AND policyname = 'enterprise treasury_state_snapshots'
  ) THEN
    CREATE POLICY "enterprise treasury_state_snapshots"
      ON treasury_state_snapshots
      FOR ALL
      USING (enterprise_id = auth_user_enterprise_id())
      WITH CHECK (enterprise_id = auth_user_enterprise_id());
  END IF;
END $$;

COMMENT ON TABLE treasury_state_snapshots IS
  'Point-in-time aggregate of treasury state. Consumed by ForecastEngine (T10) '
  'and forecast_snapshots (0038) via their source_state_snapshot_id FK.';
