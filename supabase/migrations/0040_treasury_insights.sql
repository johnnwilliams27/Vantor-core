-- ============================================================
-- 0037: Treasury Insights Engine
-- ============================================================
-- The proactive insights engine that watches every state change
-- and surfaces structured recommendations to the treasurer.
--
-- Distinct from `ai_recommendations`:
--   - ai_recommendations: daily rules-engine output (onramp/offramp/no_action).
--   - treasury_insights: multi-detector output (liquidity, yield rebalance,
--     concentration risk, etc.) from the continuous insights engine.
--
-- Design notes live in the plan file. Key decisions:
--   - No action is auto-executable from insights (policy engine invariant #3).
--   - Dedup is enforced via a stable `dedup_key` per detector + parameters.
--   - Insights auto-expire 48h after creation if untouched.
--   - State transitions are tracked in `audit_logs` via the insight lifecycle
--     audit_action enum values (added below).
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. New audit_action enum values for the insight lifecycle
-- ---------------------------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'insight_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'insight_view';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'insight_dismiss';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'insight_acted_on';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'insight_expire';

-- ---------------------------------------------------------------------------
-- 2. New enum types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE insight_type AS ENUM (
    'liquidity_below_buffer',
    'liquidity_idle_cash',
    'yield_drop',
    'yield_opportunity',
    'yield_idle_opportunity',
    'concentration_warning',
    'concentration_breach'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE insight_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE insight_state AS ENUM ('new', 'viewed', 'dismissed', 'acted_on', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. treasury_insights table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS treasury_insights (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id         UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  -- `user_id` is the primary recipient of the insight. For multi-user
  -- enterprises the cron creates one row per treasury_manager user. Used
  -- for per-user dedup/cooldown and the user's insight feed.
  user_id               UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  detector_name         TEXT NOT NULL,
  insight_type          insight_type NOT NULL,
  severity              insight_severity NOT NULL,
  state                 insight_state NOT NULL DEFAULT 'new',

  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,                   -- template for info/warning, Claude for critical
  ai_reasoning          TEXT,                            -- populated only for critical insights
  ai_model              TEXT,                            -- e.g. 'claude-sonnet-4-6', null if no AI call

  -- Structured data the detector used to produce the insight. Opaque JSON;
  -- frontend renders it, backend does not validate. Shape varies by detector.
  rationale             JSONB NOT NULL DEFAULT '{}',
  -- The proposed action (if any) that would resolve the insight. Structured
  -- so it can be passed directly to the policy engine's evaluate() function.
  -- Null if the insight is informational only.
  recommended_action    JSONB,
  -- Verdict returned by the policy engine when simulating recommended_action.
  -- In v1 (before the policy engine lands) this is always 'require_approval'
  -- per the policy engine invariant that AI-initiated movements never auto-execute.
  policy_verdict        TEXT,
  policy_reason         TEXT,

  impact_dollar_value   NUMERIC(36,2),
  impact_apy_delta_bps  INTEGER,
  impact_buffer_days    INTEGER,
  confidence            NUMERIC(3,2),                    -- 0.00 to 1.00

  -- From the venues registry when the insight involves a specific venue.
  -- Matches src/lib/yield/venues/categories.ts VenueCategory union.
  venue_category        TEXT,
  -- Supporting market data snapshot at time of insight creation. Stale-input
  -- handling lives in the engine, not the DB.
  data_freshness        TEXT NOT NULL DEFAULT 'fresh',
  supporting_data       JSONB NOT NULL DEFAULT '{}',

  -- Stable hash used to suppress duplicate insights within the cooldown window.
  -- Example: 'yield_opportunity:aave_v3:USDC:spiko_usd'. The cron orchestrator
  -- checks for an existing non-dismissed insight with the same dedup_key before
  -- creating a new one.
  dedup_key             TEXT NOT NULL,
  -- When non-null, the dedup_key is "locked" until this time — prevents
  -- re-creation of the same insight even after dismissal. Used by the
  -- dismiss flow to enforce a cooldown (default 24h).
  cooldown_until        TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Auto-expiry: insights untouched for 48h drop to 'expired' via cron cleanup.
  expires_at            TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  viewed_at             TIMESTAMPTZ,
  dismissed_at          TIMESTAMPTZ,
  acted_on_at           TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Fast feed lookup for the insights API and UI
CREATE INDEX IF NOT EXISTS idx_treasury_insights_enterprise_state
  ON treasury_insights(enterprise_id, state, created_at DESC)
  WHERE state IN ('new', 'viewed');

-- Fast dedup check from the cron orchestrator
CREATE INDEX IF NOT EXISTS idx_treasury_insights_dedup
  ON treasury_insights(enterprise_id, user_id, dedup_key, created_at DESC);

-- Fast expiry sweep
CREATE INDEX IF NOT EXISTS idx_treasury_insights_expires
  ON treasury_insights(expires_at)
  WHERE state IN ('new', 'viewed');

-- Per-user feed
CREATE INDEX IF NOT EXISTS idx_treasury_insights_user_state
  ON treasury_insights(user_id, state, created_at DESC);

-- ---------------------------------------------------------------------------
-- Updated_at trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_treasury_insights_updated_at ON treasury_insights;
CREATE TRIGGER set_treasury_insights_updated_at
  BEFORE UPDATE ON treasury_insights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: enterprise isolation
-- ---------------------------------------------------------------------------
ALTER TABLE treasury_insights ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "enterprise treasury_insights" ON treasury_insights
    FOR ALL USING (enterprise_id = auth_user_enterprise_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Grants for service_role and authenticated (follows project convention)
-- ---------------------------------------------------------------------------
GRANT ALL ON treasury_insights TO service_role;
GRANT SELECT, INSERT, UPDATE ON treasury_insights TO authenticated;

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
