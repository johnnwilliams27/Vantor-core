-- 0057_admin_wipe_test_policy.sql
--
-- policy_versions, policy_rules, policy_hard_limits, and policy_approval_chains
-- all have BEFORE UPDATE/DELETE triggers (from 0038) that refuse to mutate rows
-- whose parent version status is 'active' or 'superseded'. That's the correct
-- default for a production policy — but it blocks the test-mode reseed flow:
-- wipe.ts can't remove the seeded v1/v2 (superseded) or v3 (active) versions
-- and their children, so reseed leaks the entire policy chain across attempts.
--
-- This RPC mirrors fn_admin_wipe_test_approvals (0056): scoped strictly to
-- is_test_enterprise=true, temporarily disables the mutability triggers, deletes
-- the policy tree, and re-enables the triggers. Guaranteed safe because it
-- refuses to run against any enterprise that isn't flagged as a test row.

CREATE OR REPLACE FUNCTION fn_admin_wipe_test_policy(p_enterprise_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_test BOOLEAN;
  v_rules_deleted INTEGER := 0;
  v_limits_deleted INTEGER := 0;
  v_chains_deleted INTEGER := 0;
  v_versions_deleted INTEGER := 0;
  v_policies_deleted INTEGER := 0;
BEGIN
  -- Guard: only test enterprises.
  SELECT is_test_enterprise INTO v_is_test
  FROM enterprises
  WHERE id = p_enterprise_id;

  IF v_is_test IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'fn_admin_wipe_test_policy: refusing to run on non-test enterprise %', p_enterprise_id;
  END IF;

  -- Disable the draft-only mutability triggers on the policy subtree.
  ALTER TABLE policy_rules            DISABLE TRIGGER trg_policy_rules_frozen;
  ALTER TABLE policy_hard_limits      DISABLE TRIGGER trg_policy_hard_limits_frozen;
  ALTER TABLE policy_approval_chains  DISABLE TRIGGER trg_policy_approval_chains_frozen;
  ALTER TABLE policy_versions         DISABLE TRIGGER trg_policy_versions_frozen_when_active;

  -- Null out the FK cycle from policy_policies.active_version_id → policy_versions.id
  UPDATE policy_policies SET active_version_id = NULL WHERE enterprise_id = p_enterprise_id;

  -- Null out the self-ref FK on policy_versions.superseded_by_version_id
  UPDATE policy_versions SET superseded_by_version_id = NULL WHERE enterprise_id = p_enterprise_id;

  -- Delete children scoped by version_id IN (versions of this enterprise).
  WITH v AS (SELECT id FROM policy_versions WHERE enterprise_id = p_enterprise_id)
  DELETE FROM policy_rules USING v WHERE policy_rules.version_id = v.id;
  GET DIAGNOSTICS v_rules_deleted = ROW_COUNT;

  WITH v AS (SELECT id FROM policy_versions WHERE enterprise_id = p_enterprise_id)
  DELETE FROM policy_hard_limits USING v WHERE policy_hard_limits.version_id = v.id;
  GET DIAGNOSTICS v_limits_deleted = ROW_COUNT;

  WITH v AS (SELECT id FROM policy_versions WHERE enterprise_id = p_enterprise_id)
  DELETE FROM policy_approval_chains USING v WHERE policy_approval_chains.version_id = v.id;
  GET DIAGNOSTICS v_chains_deleted = ROW_COUNT;

  DELETE FROM policy_versions WHERE enterprise_id = p_enterprise_id;
  GET DIAGNOSTICS v_versions_deleted = ROW_COUNT;

  DELETE FROM policy_policies WHERE enterprise_id = p_enterprise_id;
  GET DIAGNOSTICS v_policies_deleted = ROW_COUNT;

  -- Re-enable the triggers.
  ALTER TABLE policy_rules            ENABLE TRIGGER trg_policy_rules_frozen;
  ALTER TABLE policy_hard_limits      ENABLE TRIGGER trg_policy_hard_limits_frozen;
  ALTER TABLE policy_approval_chains  ENABLE TRIGGER trg_policy_approval_chains_frozen;
  ALTER TABLE policy_versions         ENABLE TRIGGER trg_policy_versions_frozen_when_active;

  RETURN jsonb_build_object(
    'rules_deleted',    v_rules_deleted,
    'limits_deleted',   v_limits_deleted,
    'chains_deleted',   v_chains_deleted,
    'versions_deleted', v_versions_deleted,
    'policies_deleted', v_policies_deleted
  );
EXCEPTION WHEN OTHERS THEN
  -- Make sure the triggers are re-enabled even on error.
  BEGIN
    ALTER TABLE policy_rules            ENABLE TRIGGER trg_policy_rules_frozen;
    ALTER TABLE policy_hard_limits      ENABLE TRIGGER trg_policy_hard_limits_frozen;
    ALTER TABLE policy_approval_chains  ENABLE TRIGGER trg_policy_approval_chains_frozen;
    ALTER TABLE policy_versions         ENABLE TRIGGER trg_policy_versions_frozen_when_active;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$$;

COMMENT ON FUNCTION fn_admin_wipe_test_policy(UUID) IS
  'Admin/test-mode only: wipes the full policy subtree (policies/versions/rules/hard_limits/approval_chains) for a test enterprise by temporarily disabling the draft-only mutability triggers. Refuses non-test enterprises. Callable by service-role clients.';

REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_policy(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_policy(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_policy(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_wipe_test_policy(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
