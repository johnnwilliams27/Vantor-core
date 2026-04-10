-- ============================================================
-- 0031: OpenSanctions Counterparty Sanctions Screening
-- ============================================================
-- Adds counterparty entity model with screening workflow,
-- case management, and append-only audit trail.
-- ============================================================

-- 1. New audit_action enum values
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'counterparty_create';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'counterparty_screen';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_case_open';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_case_clear';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_case_escalate';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_case_block';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_case_reassign';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_case_note';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'screening_adhoc_lookup';

-- 2. New enum types
DO $$ BEGIN
  CREATE TYPE counterparty_type AS ENUM ('individual', 'business');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE counterparty_screening_status AS ENUM ('pending', 'cleared', 'flagged', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE screening_case_state AS ENUM ('open', 'cleared', 'escalated', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE case_action_type AS ENUM ('clear', 'escalate', 'block', 'reassign', 'note');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE clear_reason_code AS ENUM (
    'false_positive_name_similarity',
    'false_positive_different_entity',
    'verified_not_match',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. counterparties table
CREATE TABLE IF NOT EXISTS counterparties (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  wallet_address      TEXT NOT NULL,
  chain               chain_type NOT NULL,
  type                counterparty_type NOT NULL DEFAULT 'individual',
  screening_status    counterparty_screening_status NOT NULL DEFAULT 'pending',
  transfer_eligible   BOOLEAN NOT NULL DEFAULT false,
  last_screened_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(enterprise_id, wallet_address, chain)
);

CREATE INDEX IF NOT EXISTS idx_counterparties_enterprise ON counterparties(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_counterparties_wallet ON counterparties(wallet_address, chain);
CREATE INDEX IF NOT EXISTS idx_counterparties_screening_status ON counterparties(screening_status);
CREATE INDEX IF NOT EXISTS idx_counterparties_last_screened ON counterparties(last_screened_at)
  WHERE screening_status NOT IN ('blocked', 'pending');

ALTER TABLE counterparties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enterprise counterparties" ON counterparties
  FOR ALL USING (enterprise_id = auth_user_enterprise_id());

CREATE TRIGGER set_counterparties_updated_at
  BEFORE UPDATE ON counterparties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. counterparty_screenings table
CREATE TABLE IF NOT EXISTS counterparty_screenings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id     UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  counterparty_id   UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  screened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  dataset_version   TEXT,
  top_match_score   NUMERIC(5,4),
  top_match_label   TEXT,
  raw_response      JSONB NOT NULL DEFAULT '{}',
  result_status     counterparty_screening_status NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_screenings_counterparty ON counterparty_screenings(counterparty_id, screened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cp_screenings_enterprise ON counterparty_screenings(enterprise_id);

ALTER TABLE counterparty_screenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enterprise counterparty_screenings" ON counterparty_screenings
  FOR ALL USING (enterprise_id = auth_user_enterprise_id());

-- 5. screening_cases table
CREATE TABLE IF NOT EXISTS screening_cases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id            UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  counterparty_id          UUID NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
  screening_id             UUID NOT NULL REFERENCES counterparty_screenings(id) ON DELETE CASCADE,
  state                    screening_case_state NOT NULL DEFAULT 'open',
  assignee_user_id         UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  matched_entity_snapshot  JSONB NOT NULL DEFAULT '{}',
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screening_cases_counterparty ON screening_cases(counterparty_id);
CREATE INDEX IF NOT EXISTS idx_screening_cases_state ON screening_cases(enterprise_id, state);
CREATE INDEX IF NOT EXISTS idx_screening_cases_assignee ON screening_cases(assignee_user_id)
  WHERE state = 'open';

ALTER TABLE screening_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enterprise screening_cases" ON screening_cases
  FOR ALL USING (enterprise_id = auth_user_enterprise_id());

CREATE TRIGGER set_screening_cases_updated_at
  BEFORE UPDATE ON screening_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. case_actions table (append-only)
CREATE TABLE IF NOT EXISTS case_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID NOT NULL REFERENCES screening_cases(id) ON DELETE CASCADE,
  actor_user_id   UUID NOT NULL,
  action          case_action_type NOT NULL,
  reason_code     clear_reason_code,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_actions_case ON case_actions(case_id, created_at);

ALTER TABLE case_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enterprise case_actions" ON case_actions
  FOR ALL USING (
    case_id IN (
      SELECT id FROM screening_cases WHERE enterprise_id = auth_user_enterprise_id()
    )
  );

-- Append-only enforcement: prevent UPDATE and DELETE on case_actions
CREATE OR REPLACE FUNCTION prevent_case_action_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case_actions is append-only: % operations are not permitted', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_case_actions_append_only_update
  BEFORE UPDATE ON case_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_case_action_mutation();

CREATE TRIGGER enforce_case_actions_append_only_delete
  BEFORE DELETE ON case_actions
  FOR EACH ROW EXECUTE FUNCTION prevent_case_action_mutation();

-- 7. Add optional counterparty_id to transfers
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS counterparty_id UUID REFERENCES counterparties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transfers_counterparty ON transfers(counterparty_id);
