-- Migration: 0060_policy_deactivate_rpc.sql
-- Atomic PL/pgSQL function for policy deactivation.
--
-- Clears the active_version_id pointer and supersedes the version,
-- preserving all rules/chains/limits intact. The enterprise returns
-- to "no active policy" state (engine returns allow_auto).

CREATE OR REPLACE FUNCTION policy_deactivate_version(
  p_version_id    uuid,
  p_enterprise_id uuid,
  p_deactivated_by uuid,
  p_reason        text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status          text;
  v_active_id       uuid;
BEGIN
  -- 1. Validate reason length
  IF length(trim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'Deactivation reason must be at least 20 characters.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock and validate the target version
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

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Policy version % has status ''%'' and is not active.',
      p_version_id, v_status
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Confirm this version is actually the active pointer
  SELECT active_version_id
    INTO v_active_id
    FROM policy_policies
   WHERE enterprise_id = p_enterprise_id
   FOR UPDATE;

  IF v_active_id IS DISTINCT FROM p_version_id THEN
    RAISE EXCEPTION 'Version % is not the active version for this enterprise.',
      p_version_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. Supersede the version (preserves all rules/chains/limits)
  UPDATE policy_versions
     SET status = 'superseded'
   WHERE id = p_version_id;

  -- 5. Clear the active pointer
  UPDATE policy_policies
     SET active_version_id = NULL
   WHERE enterprise_id = p_enterprise_id;

  -- 6. Record event for audit trail
  INSERT INTO policy_activation_events (
    enterprise_id, version_id, previous_version_id,
    activated_by, reason
  ) VALUES (
    p_enterprise_id, NULL, p_version_id,
    p_deactivated_by, p_reason
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION policy_deactivate_version(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION policy_deactivate_version(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION policy_deactivate_version(uuid, uuid, uuid, text) TO service_role;
