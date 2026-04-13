-- 0056_admin_wipe_test_approvals.sql
--
-- policy_approval_requests has a rewrite rule (policy_approval_requests_no_delete,
-- defined in 0038) that rewrites every DELETE to NOTHING, preventing both service-role
-- clients and RLS-bound clients from removing rows. That's the right default for
-- production audit, but it blocks the test-mode reseed flow: when an admin clicks
-- "Reset test data", wipe.ts cannot clear stale approval rows, so new seeds stack
-- on top of old (possibly malformed) ones — and the /approvals page crashes when
-- it tries to render the old rows.
--
-- This function carves out a narrow, audited exception: it deletes rows scoped to
-- a specific test enterprise only, and REFUSES to run against a non-test enterprise.
--
-- It uses ALTER TABLE … DISABLE RULE temporarily. This briefly disables the rule
-- for ALL sessions — but the function body is small (one DELETE) and the function
-- is only called by the admin reseed path, which itself is infrequent.

CREATE OR REPLACE FUNCTION fn_admin_wipe_test_approvals(p_enterprise_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_test BOOLEAN;
  v_deleted INTEGER;
BEGIN
  -- Guard: only test enterprises. Refuse otherwise.
  SELECT is_test_enterprise INTO v_is_test
  FROM enterprises
  WHERE id = p_enterprise_id;

  IF v_is_test IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'fn_admin_wipe_test_approvals: refusing to run on non-test enterprise %', p_enterprise_id;
  END IF;

  -- Temporarily disable the no_delete rule, delete, re-enable.
  ALTER TABLE policy_approval_requests DISABLE RULE policy_approval_requests_no_delete;

  DELETE FROM policy_approval_requests
  WHERE enterprise_id = p_enterprise_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  ALTER TABLE policy_approval_requests ENABLE RULE policy_approval_requests_no_delete;

  RETURN v_deleted;
EXCEPTION WHEN OTHERS THEN
  -- Ensure the rule is re-enabled even on error
  BEGIN
    ALTER TABLE policy_approval_requests ENABLE RULE policy_approval_requests_no_delete;
  EXCEPTION WHEN OTHERS THEN
    -- Swallow — rule may already be enabled
    NULL;
  END;
  RAISE;
END;
$$;

COMMENT ON FUNCTION fn_admin_wipe_test_approvals(UUID) IS
  'Admin/test-mode only: wipes policy_approval_requests for a test enterprise by temporarily disabling the no_delete rule. Refuses non-test enterprises. Callable by service-role clients.';

-- Only service_role should be able to call this. Revoke from authenticated/anon.
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_approvals(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_approvals(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_admin_wipe_test_approvals(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION fn_admin_wipe_test_approvals(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
