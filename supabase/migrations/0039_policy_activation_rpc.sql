-- Migration: 0039_policy_activation_rpc.sql
-- Creates the atomic PL/pgSQL function for policy version activation.
--
-- The function is called from PolicyAuthoringService.activateVersion() and
-- performs the following in a single transaction:
--   1. Validates the activation reason is at least 20 chars (P0001 if not)
--   2. Validates the target version is still 'draft' (P0002 if not)
--   3. Supersedes any previously-active version for this enterprise
--   4. Marks the target version 'active' with activated_at / activated_by
--   5. Upserts policy_policies.active_version_id
--   6. Records activation event in policy_activation_events
--
-- SECURITY: The function is SECURITY DEFINER (runs as owner, bypassing RLS)
-- so it MUST be restricted to service_role only. Authenticated users must
-- NOT be able to call this directly via PostgREST — all permission checks
-- (requirePolicyAdmin, validateVersionCoherent, checkChainSatisfiability)
-- happen in the JS service layer.

CREATE OR REPLACE FUNCTION policy_activate_draft(
  p_version_id    uuid,
  p_enterprise_id uuid,
  p_activated_by  uuid,
  p_reason        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status          text;
  v_prev_active_id  uuid;
BEGIN
  -- 1. Validate reason length (defense-in-depth backstop; JS pre-checks too)
  IF length(trim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'Activation reason must be at least 20 characters.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Load the target version and lock it for update
  SELECT status
    INTO v_status
    FROM policy_versions
   WHERE id = p_version_id
     AND enterprise_id = p_enterprise_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Policy version % not found for enterprise %.',
      p_version_id, p_enterprise_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Policy version % has status ''%'' and is not a draft.',
      p_version_id, v_status
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Find the currently-active version for this enterprise (if any)
  --    Lock the policy_policies row to serialize concurrent activations.
  SELECT active_version_id
    INTO v_prev_active_id
    FROM policy_policies
   WHERE enterprise_id = p_enterprise_id
   FOR UPDATE;

  -- 4. Supersede the previous active version
  IF v_prev_active_id IS NOT NULL AND v_prev_active_id <> p_version_id THEN
    UPDATE policy_versions
       SET status = 'superseded'
     WHERE id = v_prev_active_id;
  END IF;

  -- 5. Activate the target version
  UPDATE policy_versions
     SET status       = 'active',
         activated_at = now(),
         activated_by = p_activated_by
   WHERE id = p_version_id;

  -- 6. Upsert policy_policies row
  INSERT INTO policy_policies (enterprise_id, active_version_id)
  VALUES (p_enterprise_id, p_version_id)
  ON CONFLICT (enterprise_id)
  DO UPDATE SET active_version_id = EXCLUDED.active_version_id;

  -- 7. Record activation event (audit trail)
  INSERT INTO policy_activation_events (
    enterprise_id, version_id, previous_version_id,
    activated_by, reason
  ) VALUES (
    p_enterprise_id, p_version_id, v_prev_active_id,
    p_activated_by, p_reason
  );
END;
$$;

-- CRITICAL: Restrict execution to service_role only.
-- Without this, any authenticated Supabase user could call this RPC
-- directly via PostgREST, bypassing all JS-layer permission checks,
-- validation, and satisfiability checks.
REVOKE EXECUTE ON FUNCTION policy_activate_draft(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION policy_activate_draft(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION policy_activate_draft(uuid, uuid, uuid, text) TO service_role;
