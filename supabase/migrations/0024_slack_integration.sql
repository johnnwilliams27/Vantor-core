-- ============================================================
-- 0007_slack_integration.sql  –  Slack Integration
-- ============================================================

-- --------------------------------------------------------
-- New audit_action enum values
-- --------------------------------------------------------
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'slack_connect';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'slack_disconnect';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'slack_test';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'slack_recommendation_notify';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'slack_recommendation_approve';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'slack_recommendation_reject';

-- --------------------------------------------------------
-- slack_integrations
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS slack_integrations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  workspace_name   TEXT,
  team_id          TEXT,
  channel_id       TEXT NOT NULL,
  channel_name     TEXT,
  credentials      TEXT NOT NULL,  -- encrypted JSON: {botToken, signingSecret}
  is_active        BOOLEAN NOT NULL DEFAULT true,
  verified_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_integrations_team ON slack_integrations(team_id) WHERE is_active = true;

ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'slack_integrations' AND policyname = 'users own slack_integrations'
  ) THEN
    CREATE POLICY "users own slack_integrations" ON slack_integrations FOR ALL USING (user_id = auth.uid());
  END IF;
END $$;
