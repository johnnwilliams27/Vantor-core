-- ============================================================
-- 0040_drop_audit_logs_enterprise_fk.sql — remove FK constraints
-- that clash with audit-style rewrite rules on child tables.
-- ============================================================
--
-- Context: several tables in this schema use a rewrite rule to enforce
-- immutability at the Postgres level:
--
--   CREATE RULE <table>_no_delete AS ON DELETE TO <table> DO INSTEAD NOTHING;
--   CREATE RULE <table>_no_update AS ON UPDATE TO <table> DO INSTEAD NOTHING;
--
-- The original such rule is `no_delete_audit_logs` from
-- 0001_init_schema.sql:237. The pattern was later replicated for several
-- policy-engine tables (`policy_approval_requests`, `policy_activation_events`,
-- `policy_evaluations`).
--
-- Separately, every tenant-scoped table has
--   enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE
-- so that deleting an enterprise sweeps its data.
--
-- Those two mechanisms are silently incompatible. When an enterprise
-- is deleted, Postgres' referential-integrity machinery compiles and
-- executes a DELETE against the child table as the cascade action.
-- The rewrite rule intercepts that phantom DELETE and rewrites it
-- to NOTHING. The RI trigger then reports:
--
--   referential integrity query on "enterprises" from constraint
--   "<table>_enterprise_id_fkey" on "<table>" gave unexpected result
--
-- This error fires even when the child table has zero rows referencing
-- the target enterprise — the planner compiles the RI check against the
-- rewritten relation and cannot interpret the empty-rule result. See
-- https://www.postgresql.org/docs/current/rules.html for the general
-- interaction between RI and rewrite rules.
--
-- Symptom on dev: every integration-test enterprise created by
-- tests/helpers/test-db.ts silently survived its afterAll() cleanup
-- (24 stale enterprises accumulated before this fix shipped), and
-- a direct DELETE from enterprises returns the error above.
--
-- Fix: drop the FK constraint on each affected child table. The rewrite
-- rule is the real mechanism enforcing immutability; the FK's only
-- contribution was to block enterprise deletes. These rows are
-- historical records and should survive the deletion of the enterprise
-- they reference — they capture events that actually happened.
--
-- enterprise_id column values are preserved verbatim. We are dropping
-- the constraint, not the column.
--
-- The policy_* tables live on some environments (dev, any worktree that
-- cherry-picked the policy-engine branch) but not on master as of this
-- writing. Each DROP is wrapped in a to_regclass existence check so
-- the migration is a no-op against environments where the table was
-- never created.

-- 1. audit_logs — the original case, owned by this schema's 0001/0010.
ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_enterprise_id_fkey;

COMMENT ON COLUMN audit_logs.enterprise_id IS
  'Tenant scope at write time. Not FK-enforced — enterprises may be '
  'deleted while audit records referencing them survive. See migration '
  '0040 for the rewrite-rule interaction that forced dropping the FK.';

-- 2-5. policy_* tables — cross-branch contamination from the
--      feature/policy-engine branch. Each drop is guarded so this
--      migration is safe to run on environments without those tables.
DO $$
BEGIN
  IF to_regclass('public.policy_approval_requests') IS NOT NULL THEN
    ALTER TABLE policy_approval_requests
      DROP CONSTRAINT IF EXISTS policy_approval_requests_enterprise_id_fkey;
  END IF;

  IF to_regclass('public.policy_activation_events') IS NOT NULL THEN
    ALTER TABLE policy_activation_events
      DROP CONSTRAINT IF EXISTS policy_activation_events_enterprise_id_fkey;
  END IF;

  IF to_regclass('public.policy_evaluations') IS NOT NULL THEN
    ALTER TABLE policy_evaluations
      DROP CONSTRAINT IF EXISTS policy_evaluations_enterprise_id_fkey;
  END IF;
END $$;
