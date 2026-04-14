-- Per-rule trigger counts for the Policy dashboard + version editor.
--
-- Each gate evaluation writes rules_evaluated[] into policy_evaluations.trace,
-- where each entry is an object with { rule_id, matched, ... }. This function
-- counts distinct rule triggers over a time window for a given enterprise +
-- version, grouped by rule_id.
--
-- Use cases:
--   - Dashboard: "top firing rules in the last 7 days"
--   - Version editor: "fired N× last 30d" inline on each rule row
--
-- Filters:
--   - Only counts rules where `matched = true` AND `verdict_contribution`
--     is non-null (excludes informational/non-decisive matches).
--   - Scoped to a specific version_id if provided; null = all versions
--     active in the window.

CREATE OR REPLACE FUNCTION fn_policy_rule_trigger_counts(
  p_enterprise_id UUID,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_version_id UUID DEFAULT NULL
)
RETURNS TABLE(
  rule_id UUID,
  rule_name TEXT,
  trigger_count INT,
  last_triggered_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  WITH rule_events AS (
    SELECT
      (rule->>'rule_id')::UUID AS rule_id,
      rule->>'rule_name' AS rule_name,
      e.created_at AS evaluated_at
    FROM policy_evaluations e,
         LATERAL jsonb_array_elements(e.trace->'rules_evaluated') AS rule
    WHERE e.enterprise_id = p_enterprise_id
      AND e.created_at >= p_window_start
      AND e.created_at <  p_window_end
      AND (p_version_id IS NULL OR e.version_id = p_version_id)
      AND (rule->>'matched')::boolean = TRUE
      AND rule->>'verdict_contribution' IS NOT NULL
      AND rule->>'verdict_contribution' <> 'null'
  )
  SELECT
    rule_id,
    -- Take the most recent rule_name seen (names can change across version edits)
    (array_agg(rule_name ORDER BY evaluated_at DESC))[1] AS rule_name,
    COUNT(*)::int AS trigger_count,
    MAX(evaluated_at) AS last_triggered_at
  FROM rule_events
  GROUP BY rule_id
  ORDER BY trigger_count DESC;
$$;

COMMENT ON FUNCTION fn_policy_rule_trigger_counts IS
  'Per-rule trigger counts within a time window. Powers dashboard top-firing-rules + inline rule trigger badges in the version editor.';

-- Index on evaluation time for the dashboard queries (already partial-indexed
-- for the aggregate runner; this is a broader index for all evaluations).
CREATE INDEX IF NOT EXISTS policy_evaluations_created_at_idx
  ON policy_evaluations (enterprise_id, created_at DESC);
