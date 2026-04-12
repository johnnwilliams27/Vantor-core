-- ============================================================
-- 0049: RBAC hierarchy — executive role + enterprise_rbac_settings
-- ============================================================
-- Part of the RBAC hierarchy work. See
-- docs/superpowers/plans/2026-04-12-rbac-hierarchy.md for context.
--
-- This migration does three things:
--   1. Add the `executive` role to the user_role enum. CFO/Treasurer
--      tier — approves high-threshold transfers, cannot author
--      policies. Required by src/lib/auth/roles.ts Task 1.
--   2. Create enterprise_rbac_settings — one row per enterprise
--      holding the author-approver separation toggle. Default ON
--      (strict) per the product decision.
--   3. Upgrade any user currently using `is_policy_admin=true` as
--      the authoring gate to role='enterprise_admin'. Task 1's new
--      permissions model makes role the single gate; this keeps
--      existing authors powered while the flag is retired in a
--      follow-up migration (1-2 week rollback window).
--
-- The `is_policy_admin` column itself is NOT dropped here — that
-- happens in a follow-up so we preserve a rollback path if we need
-- to revert any of the role-based gating logic.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. Add 'executive' to user_role enum
-- ---------------------------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'executive';

-- ---------------------------------------------------------------------------
-- 2. enterprise_rbac_settings — per-enterprise RBAC configuration
-- ---------------------------------------------------------------------------
-- One row per enterprise. `resolveRbacSettings(enterpriseId)` in the
-- application upserts defaults if no row exists, mirroring the pattern
-- used by customer_insight_settings (migration 0048). No backfill —
-- first access creates the row.
--
-- No audit rewrite rules on this table. Settings are meant to be
-- updated; change tracking goes through audit_logs.
CREATE TABLE IF NOT EXISTS enterprise_rbac_settings (
  enterprise_id                      UUID PRIMARY KEY REFERENCES enterprises(id) ON DELETE CASCADE,
  -- When true, a user who authored any rule that triggered an approval
  -- request cannot also fill a slot on that same request. Enforced at
  -- runtime by src/lib/policy/approvals/sod.ts. Default ON (strict)
  -- per product decision.
  author_approver_separation_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Updated_at trigger — follows 0048 pattern
DROP TRIGGER IF EXISTS set_enterprise_rbac_settings_updated_at ON enterprise_rbac_settings;
CREATE TRIGGER set_enterprise_rbac_settings_updated_at
  BEFORE UPDATE ON enterprise_rbac_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: enterprise isolation
ALTER TABLE enterprise_rbac_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "enterprise enterprise_rbac_settings" ON enterprise_rbac_settings
    FOR ALL USING (enterprise_id = auth_user_enterprise_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Grants — follows 0048 pattern
GRANT ALL ON enterprise_rbac_settings TO service_role;
GRANT SELECT, INSERT, UPDATE ON enterprise_rbac_settings TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Data migration: upgrade legacy is_policy_admin=true users
-- ---------------------------------------------------------------------------
-- Before this change, authoring was gated on `role='treasury_manager'
-- AND is_policy_admin=true`. Task 1 of the RBAC plan makes authoring
-- gated on `role='enterprise_admin'` only. Any user currently trusted
-- to author who isn't already enterprise_admin needs to be upgraded
-- so they don't silently lose their authoring power on deploy.
--
-- This is idempotent — re-running finds no rows matching the WHERE.
UPDATE user_profiles
SET role = 'enterprise_admin'
WHERE is_policy_admin = true
  AND role <> 'enterprise_admin';

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
