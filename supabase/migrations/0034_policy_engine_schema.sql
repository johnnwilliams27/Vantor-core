-- Migration 0034: Policy Engine Schema
-- Creates all policy_* tables for the treasury rules & approval policy engine.
-- See docs/superpowers/specs/2026-04-10-treasury-policy-engine-design.md §1.
--
-- This migration is SCHEMA-ONLY. Data migration (from treasury_rules and
-- ai_recommendations.pending_approval) happens in a separate migration in
-- Plan 2. After this migration, all policy_* tables are empty and nothing
-- in production reads from them yet.

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- CONFIGURATION TABLES (versioned, immutable once active)
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE policy_policies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL UNIQUE REFERENCES enterprises(id) ON DELETE CASCADE,
  name                TEXT NOT NULL DEFAULT 'Standard Policy',
  active_version_id   UUID,  -- FK added after policy_versions exists
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_policies IS
  'One row per enterprise. Holds the pointer to the currently-active policy version.';

CREATE TABLE policy_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id           UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  version_number          INTEGER NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
  name                    TEXT NOT NULL,
  created_by              UUID NOT NULL REFERENCES user_profiles(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at            TIMESTAMPTZ,
  activated_by            UUID REFERENCES user_profiles(id),
  superseded_at           TIMESTAMPTZ,
  superseded_by_version_id UUID REFERENCES policy_versions(id),
  UNIQUE (enterprise_id, version_number)
);

COMMENT ON TABLE policy_versions IS
  'Immutable policy version snapshots. Draft versions may be edited freely; ' ||
  'active and superseded versions are frozen by triggers.';

-- Complete the FK on policy_policies now that policy_versions exists
ALTER TABLE policy_policies
  ADD CONSTRAINT fk_active_version
  FOREIGN KEY (active_version_id) REFERENCES policy_versions(id);

CREATE TABLE policy_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          UUID NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  rule_type           TEXT NOT NULL CHECK (rule_type IN (
                        'approval_threshold', 'counterparty', 'time_window', 'lookahead'
                      )),
  name                TEXT NOT NULL,
  rationale           TEXT NOT NULL DEFAULT '',
  condition           JSONB NOT NULL,  -- Typed condition IR; validated by zod at save time
  verdict             TEXT NOT NULL CHECK (verdict IN ('allow_auto', 'require_approval', 'block')),
  verdict_chain_id    UUID,  -- FK added after policy_approval_chains exists
  priority            INTEGER NOT NULL,
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, priority)
);

COMMENT ON TABLE policy_rules IS
  'Individual rules belonging to a policy version. Condition IR stored as JSONB. ' ||
  'Rule type is a UI category hint, not an evaluation-semantic distinction.';

CREATE TABLE policy_hard_limits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          UUID NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  limit_type          TEXT NOT NULL CHECK (limit_type IN (
                        'min_cash_reserve_usd',
                        'max_single_asset_concentration_pct',
                        'max_daily_outflow_usd',
                        'max_30day_outflow_usd',
                        'obligation_coverage_days',
                        'max_native_exposure'
                      )),
  name                TEXT NOT NULL,
  limit_value         TEXT NOT NULL,  -- String-serialized numeric to avoid float precision loss
  limit_currency      TEXT,            -- Asset code for monetary limits, NULL for %/duration
  scope               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_hard_limits IS
  'Typed structural limits, NOT condition-DSL rules. Each row is a named ' ||
  'parameter with a numeric/duration value. Only is_policy_admin users can ' ||
  'modify these (enforced at API layer in Plan 2).';

CREATE TABLE policy_approval_chains (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id          UUID NOT NULL REFERENCES policy_versions(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  slots               JSONB NOT NULL,  -- Array of { slot_index, minimum_role, label? }
  trigger_condition   JSONB,            -- Optional condition IR; when matched, this chain applies
  priority            INTEGER NOT NULL DEFAULT 0,
  expiration_hours    INTEGER NOT NULL DEFAULT 24 CHECK (expiration_hours > 0),
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_approval_chains IS
  'Approval chain definitions. When a rule triggers require_approval, the ' ||
  'matching chain determines who must sign off.';

-- Complete the FK on policy_rules now that chains exist
ALTER TABLE policy_rules
  ADD CONSTRAINT fk_verdict_chain
  FOREIGN KEY (verdict_chain_id) REFERENCES policy_approval_chains(id);

-- ════════════════════════════════════════════════════════════════════════
-- RUNTIME / APPEND-ONLY TABLES
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE policy_approval_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  version_id          UUID NOT NULL REFERENCES policy_versions(id),
  movement_id         TEXT NOT NULL,  -- Idempotency key from gate
  proposed_movement   JSONB NOT NULL,
  triggered_rule_ids  UUID[] NOT NULL DEFAULT '{}',
  chain_id            UUID NOT NULL REFERENCES policy_approval_chains(id),
  slot_assignments    JSONB NOT NULL,  -- Array of { slot_index, minimum_role, filled_by, filled_at, justification }
  status              TEXT NOT NULL CHECK (status IN (
                        'pending', 'approved', 'executed', 'denied', 'escalated', 'cancelled'
                      )),
  denial_reason       TEXT CHECK (denial_reason IN ('manual', 'expired', 'stale_reeval')),
  expires_at          TIMESTAMPTZ NOT NULL,
  created_by          UUID REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  resolution_notes    JSONB,
  version             INTEGER NOT NULL DEFAULT 0  -- Optimistic lock
);

COMMENT ON TABLE policy_approval_requests IS
  'Approval queue. Version pinned at creation; re-evaluation at execution time ' ||
  'uses the then-current active version. DELETE forbidden.';

CREATE TABLE policy_evaluations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id           UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  version_id              UUID NOT NULL REFERENCES policy_versions(id),
  movement_id             TEXT NOT NULL,
  proposed_movement       JSONB NOT NULL,
  context_snapshot        JSONB NOT NULL,  -- Full EvaluationContext for replay
  verdict                 TEXT NOT NULL CHECK (verdict IN (
                            'allow_auto', 'require_approval', 'block', 'block_hard_limit'
                          )),
  trace                   JSONB NOT NULL,
  canonicalization        JSONB NOT NULL,
  reason_codes            TEXT[] NOT NULL DEFAULT '{}',
  approval_request_id     UUID REFERENCES policy_approval_requests(id),
  executed_at             TIMESTAMPTZ,  -- Populated only after adapter success
  execution_ref           TEXT,          -- Adapter's execution id
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_evaluations IS
  'Append-only evaluation trace + context snapshot. Simulation replays against ' ||
  'context_snapshot. Only executed_at and execution_ref may be updated after insert.';

CREATE TABLE policy_simulation_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  draft_version_id    UUID NOT NULL REFERENCES policy_versions(id),
  window_start        TIMESTAMPTZ NOT NULL,
  window_end          TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('running', 'completed', 'cancelled', 'failed')),
  progress            JSONB NOT NULL DEFAULT '{"processed": 0, "total": 0}'::jsonb,
  result              JSONB,
  failure             JSONB,
  created_by          UUID NOT NULL REFERENCES user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

COMMENT ON TABLE policy_simulation_runs IS
  'Shadow-mode simulation runs. Async job writes progress and final result here.';

CREATE TABLE policy_activation_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  from_version_id     UUID REFERENCES policy_versions(id),  -- NULL for v1
  to_version_id       UUID NOT NULL REFERENCES policy_versions(id),
  activated_by        UUID NOT NULL REFERENCES user_profiles(id),
  activated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason              TEXT NOT NULL CHECK (length(trim(reason)) >= 20),
  diff_summary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_source        TEXT NOT NULL DEFAULT 'customer' CHECK (actor_source IN ('customer', 'vantor_staff'))
);

COMMENT ON TABLE policy_activation_events IS
  'Append-only log of every policy version activation. Reason must be ≥20 chars. ' ||
  'DELETE and UPDATE forbidden by triggers.';

-- ════════════════════════════════════════════════════════════════════════
-- OBSERVABILITY TABLES
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE policy_forecast_stub_calls (
  id              BIGSERIAL PRIMARY KEY,
  enterprise_id   UUID NOT NULL,  -- Intentionally not FK (engineering observability)
  method          TEXT NOT NULL,
  args_json       JSONB,
  called_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_forecast_stub_calls IS
  'Engineering observability: counts of forecast stub usage. NOT customer data, ' ||
  'not RLS-protected. Tracks rollout urgency of the real forecast module.';

CREATE TABLE policy_migration_warnings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id       UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id             UUID REFERENCES user_profiles(id),  -- NULL for enterprise-wide warnings
  warning_code        TEXT NOT NULL,
  human_readable      TEXT NOT NULL,
  details             JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE policy_migration_warnings IS
  'One-shot migration hints surfaced as banners to affected users/enterprises. ' ||
  'Populated by Plan 2 data migration; empty after this schema-only plan.';

-- ════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY TRIGGERS
-- ════════════════════════════════════════════════════════════════════════

-- policy_evaluations: UPDATE restricted to executed_at + execution_ref only
CREATE OR REPLACE FUNCTION policy_evaluations_restricted_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.verdict          IS DISTINCT FROM NEW.verdict           OR
     OLD.trace            IS DISTINCT FROM NEW.trace             OR
     OLD.canonicalization IS DISTINCT FROM NEW.canonicalization  OR
     OLD.context_snapshot IS DISTINCT FROM NEW.context_snapshot  OR
     OLD.proposed_movement IS DISTINCT FROM NEW.proposed_movement OR
     OLD.version_id       IS DISTINCT FROM NEW.version_id        OR
     OLD.enterprise_id    IS DISTINCT FROM NEW.enterprise_id     OR
     OLD.movement_id      IS DISTINCT FROM NEW.movement_id       OR
     OLD.reason_codes     IS DISTINCT FROM NEW.reason_codes      OR
     OLD.approval_request_id IS DISTINCT FROM NEW.approval_request_id OR
     OLD.created_at       IS DISTINCT FROM NEW.created_at        THEN
    RAISE EXCEPTION 'policy_evaluations is append-only except for executed_at and execution_ref';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_evaluations_restricted_update
  BEFORE UPDATE ON policy_evaluations
  FOR EACH ROW EXECUTE FUNCTION policy_evaluations_restricted_update();

CREATE RULE policy_evaluations_no_delete AS
  ON DELETE TO policy_evaluations DO INSTEAD NOTHING;

-- policy_activation_events: fully append-only
CREATE RULE policy_activation_events_no_update AS
  ON UPDATE TO policy_activation_events DO INSTEAD NOTHING;
CREATE RULE policy_activation_events_no_delete AS
  ON DELETE TO policy_activation_events DO INSTEAD NOTHING;

-- policy_approval_requests: DELETE forbidden, UPDATEs allowed for state transitions
CREATE RULE policy_approval_requests_no_delete AS
  ON DELETE TO policy_approval_requests DO INSTEAD NOTHING;

-- policy_versions: UPDATE forbidden when status != 'draft'
-- Exception: transition from 'draft' to 'active', and from 'active' to 'superseded'
CREATE OR REPLACE FUNCTION policy_versions_frozen_when_active()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'draft' THEN
    -- Draft can transition freely
    RETURN NEW;
  END IF;

  IF OLD.status = 'active' THEN
    -- Active can only become superseded
    IF NEW.status != 'superseded' THEN
      RAISE EXCEPTION 'Active policy versions can only transition to superseded, not %', NEW.status;
    END IF;
    -- Verify all other fields frozen
    IF OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR
       OLD.version_number IS DISTINCT FROM NEW.version_number OR
       OLD.name IS DISTINCT FROM NEW.name OR
       OLD.created_by IS DISTINCT FROM NEW.created_by OR
       OLD.created_at IS DISTINCT FROM NEW.created_at OR
       OLD.activated_at IS DISTINCT FROM NEW.activated_at OR
       OLD.activated_by IS DISTINCT FROM NEW.activated_by THEN
      RAISE EXCEPTION 'Active->superseded transition cannot modify non-supersession fields';
    END IF;
    RETURN NEW;
  END IF;

  -- Superseded is fully frozen
  RAISE EXCEPTION 'Superseded policy versions cannot be modified';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_versions_frozen_when_active
  BEFORE UPDATE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION policy_versions_frozen_when_active();

-- Child tables (rules, hard_limits, approval_chains): UPDATE/DELETE forbidden
-- when parent version's status != 'draft'
CREATE OR REPLACE FUNCTION policy_child_frozen_when_parent_not_draft()
RETURNS TRIGGER AS $$
DECLARE
  parent_status TEXT;
BEGIN
  SELECT status INTO parent_status
  FROM policy_versions
  WHERE id = COALESCE(NEW.version_id, OLD.version_id);

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'Parent policy version not found';
  END IF;

  IF parent_status != 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify % row: parent policy version is % (only draft versions are mutable)',
      TG_TABLE_NAME, parent_status;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_rules_frozen
  BEFORE UPDATE OR DELETE ON policy_rules
  FOR EACH ROW EXECUTE FUNCTION policy_child_frozen_when_parent_not_draft();

CREATE TRIGGER trg_policy_hard_limits_frozen
  BEFORE UPDATE OR DELETE ON policy_hard_limits
  FOR EACH ROW EXECUTE FUNCTION policy_child_frozen_when_parent_not_draft();

CREATE TRIGGER trg_policy_approval_chains_frozen
  BEFORE UPDATE OR DELETE ON policy_approval_chains
  FOR EACH ROW EXECUTE FUNCTION policy_child_frozen_when_parent_not_draft();

-- ════════════════════════════════════════════════════════════════════════
-- ROW-LEVEL SECURITY POLICIES
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE policy_policies             ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_versions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_rules                ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_hard_limits          ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_approval_chains      ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_approval_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_evaluations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_simulation_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_activation_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_migration_warnings   ENABLE ROW LEVEL SECURITY;
-- policy_forecast_stub_calls intentionally NOT RLS (engineering observability)

-- Helper function (idempotent — may already exist from prior migrations)
-- Returns enterprise_ids visible to the current authenticated user
CREATE OR REPLACE FUNCTION user_enterprise_ids()
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT enterprise_id FROM user_profiles WHERE id = auth.uid();
$$;

-- Enterprise-scoped SELECT and WRITE for all customer-facing policy tables
CREATE POLICY policy_policies_enterprise_scoped ON policy_policies
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_versions_enterprise_scoped ON policy_versions
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_rules_enterprise_scoped ON policy_rules
  FOR ALL
  USING (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ))
  WITH CHECK (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ));

CREATE POLICY policy_hard_limits_enterprise_scoped ON policy_hard_limits
  FOR ALL
  USING (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ))
  WITH CHECK (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ));

CREATE POLICY policy_approval_chains_enterprise_scoped ON policy_approval_chains
  FOR ALL
  USING (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ))
  WITH CHECK (version_id IN (
    SELECT id FROM policy_versions WHERE enterprise_id IN (SELECT user_enterprise_ids())
  ));

CREATE POLICY policy_approval_requests_enterprise_scoped ON policy_approval_requests
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_evaluations_enterprise_scoped ON policy_evaluations
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_simulation_runs_enterprise_scoped ON policy_simulation_runs
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_activation_events_enterprise_scoped ON policy_activation_events
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

CREATE POLICY policy_migration_warnings_enterprise_scoped ON policy_migration_warnings
  FOR ALL
  USING (enterprise_id IN (SELECT user_enterprise_ids()))
  WITH CHECK (enterprise_id IN (SELECT user_enterprise_ids()));

-- ════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════════════════════════════════

-- Aggregate window queries — by enterprise, time, only executed rows
CREATE INDEX idx_policy_evaluations_enterprise_executed
  ON policy_evaluations (enterprise_id, executed_at DESC)
  WHERE executed_at IS NOT NULL;

-- Idempotency lookup — by movement_id
CREATE INDEX idx_policy_evaluations_movement_id
  ON policy_evaluations (movement_id);

-- Evaluation log browsing — recent-first
CREATE INDEX idx_policy_evaluations_enterprise_created
  ON policy_evaluations (enterprise_id, created_at DESC);

-- Pending approvals — partial index for sweeper + UI
CREATE INDEX idx_policy_approval_requests_pending
  ON policy_approval_requests (enterprise_id, expires_at)
  WHERE status = 'pending';

-- Approval request by movement_id — for idempotency reconstruction
CREATE INDEX idx_policy_approval_requests_movement_id
  ON policy_approval_requests (movement_id);

-- Version listing
CREATE INDEX idx_policy_versions_enterprise_status
  ON policy_versions (enterprise_id, status, version_number DESC);

-- Stub call observability
CREATE INDEX idx_policy_forecast_stub_calls_enterprise_called
  ON policy_forecast_stub_calls (enterprise_id, called_at DESC);

-- ════════════════════════════════════════════════════════════════════════
-- COLUMN ADDITIONS TO EXISTING TABLES
-- ════════════════════════════════════════════════════════════════════════

-- Per-enterprise flag granting policy admin capability (edit hard limits,
-- activate versions). Separate from is_app_admin (Vantor staff flag).
ALTER TABLE user_profiles
  ADD COLUMN is_policy_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_profiles.is_policy_admin IS
  'Per-enterprise flag: grants permission to edit hard limits and activate ' ||
  'policy versions within the user''s own enterprise. Scoped to that enterprise ' ||
  'only — does not grant cross-enterprise access. is_app_admin implicitly ' ||
  'satisfies this check for Vantor staff support scenarios.';

-- Link ai_recommendations to their corresponding approval requests
ALTER TABLE ai_recommendations
  ADD COLUMN approval_request_id UUID REFERENCES policy_approval_requests(id);

COMMENT ON COLUMN ai_recommendations.approval_request_id IS
  'Set when a recommendation enters the policy engine approval queue. ' ||
  'Used for linking display of recommendation narrative to approval actions.';

COMMIT;
