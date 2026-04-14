-- 0058_admin_wipe_test_audit.sql
--
-- audit_logs has `no_delete_audit_logs` (ON DELETE DO INSTEAD NOTHING, from
-- migration 0001) and `no_update_audit_logs` (from 0010) rewrite rules. The
-- DELETE rule rewrites every delete to nothing — PostgREST surfaces this as
--   cannot perform DELETE RETURNING on relation "audit_logs"
-- (the `RETURNING *` implicit in supabase-js deletes can't be satisfied
-- because the rule rewrites to no-op).
--
-- Same pattern as fn_admin_wipe_test_approvals (0056) and
-- fn_admin_wipe_test_policy (0057): a SECURITY DEFINER RPC that refuses
-- non-test enterprises, temporarily disables the rule, deletes, re-enables.

CREATE OR REPLACE FUNCTION fn_admin_wipe_test_audit(p_enterprise_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_test BOOLEAN;
  v_deleted INTEGER;
BEGIN
  SELECT is_test_enterprise INTO v_is_test
  FROM enterprises
  WHERE id = p_enterprise_id;

  IF v_is_test IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'fn_admin_wipe_test_audit: refusing to run on non-test enterprise %', p_enterprise_id;
  END IF;

  ALTER TABLE audit_logs DISABLE RULE no_delete_audit_logs;

  DELETE FROM audit_logs WHERE enterprise_id = p_enterprise_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  ALTER TABLE audit_logs ENABLE RULE no_delete_audit_logs;

  RETURN v_deleted;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    ALTER TABLE audit_logs ENABLE RULE no_delete_audit_logs;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RAISE;
END;
$$;

COMMENT ON FUNCTION fn_admin_wipe_test_audit(UUID) IS
  'Admin/test-mode only: wipes audit_logs for a test enterprise by temporarily disabling the no_delete_audit_logs rule. Refuses non-test enterprises.';

REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_audit(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_audit(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_audit(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_wipe_test_audit(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
