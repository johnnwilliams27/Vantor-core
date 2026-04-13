-- Migration 0054: Add channel column to treasury_insights
--
-- Phase 0 of the Agent Surfaces redesign. See
-- docs/superpowers/specs/2026-04-13-agent-surfaces-design.md §6.1.
--
-- channel='deterministic' — existing 47-detector output (default)
-- channel='advisory'      — Channel 2 narrative notes
--
-- CHECK: advisory rows cannot carry actionable fields. Enforces the
-- `channel2-advisory-only` invariant at the storage layer.

BEGIN;

ALTER TABLE treasury_insights
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'deterministic';

ALTER TABLE treasury_insights
  ADD CONSTRAINT treasury_insights_channel_values_check
  CHECK (channel IN ('deterministic', 'advisory'));

ALTER TABLE treasury_insights
  ADD CONSTRAINT treasury_insights_channel_fields_check
  CHECK (
    channel = 'deterministic'
    OR (recommended_action IS NULL AND policy_verdict IS NULL)
  );

CREATE INDEX treasury_insights_channel_idx
  ON treasury_insights(enterprise_id, channel, created_at DESC);

COMMIT;
