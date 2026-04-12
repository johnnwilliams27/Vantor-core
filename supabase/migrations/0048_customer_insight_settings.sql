-- ============================================================
-- 0048: Customer insight settings
-- ============================================================
-- Per-enterprise settings for the Treasury Insights Engine. Removes the
-- hardcoded `balanced` / `scale` defaults that the v1 cron + inline runners
-- used as placeholders.
--
-- One row per enterprise. `resolveInsightSettings(enterpriseId)` in the
-- application upserts default values if no row exists yet, so existing
-- enterprises don't need a backfill — the first detector run creates the row.
--
-- Separate from `treasury_rules`:
--   - treasury_rules: per-user rule with is_active flag (multiple rules possible).
--   - customer_insight_settings: enterprise-wide singleton.
-- Different cardinality, different owner — keep them separate.
--
-- No audit rewrite rules on this table. Settings are meant to be updated;
-- change-tracking belongs in audit_logs, not in a _no_update rule.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_insight_settings (
  enterprise_id      UUID PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
  -- Risk profile used to derive safety-buffer multiplier, tier gates, etc.
  -- Union must match src/lib/insights/types.ts RiskProfileId.
  risk_profile_id    TEXT NOT NULL DEFAULT 'balanced'
    CHECK (risk_profile_id IN ('conservative', 'balanced', 'growth')),
  -- AUM tier used by the yield-rebalance detector to gate minimums and
  -- venue eligibility. Union must match src/lib/insights/types.ts AumTier.
  aum_tier           TEXT NOT NULL DEFAULT 'scale'
    CHECK (aum_tier IN ('starter', 'growth', 'scale', 'enterprise')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Updated_at trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_customer_insight_settings_updated_at ON customer_insight_settings;
CREATE TRIGGER set_customer_insight_settings_updated_at
  BEFORE UPDATE ON customer_insight_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: enterprise isolation
-- ---------------------------------------------------------------------------
ALTER TABLE customer_insight_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "enterprise customer_insight_settings" ON customer_insight_settings
    FOR ALL USING (enterprise_id = auth_user_enterprise_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Grants (follows project convention — see 0040_treasury_insights.sql)
-- ---------------------------------------------------------------------------
GRANT ALL ON customer_insight_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON customer_insight_settings TO authenticated;

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
