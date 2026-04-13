-- ============================================================
-- 0052_policy_aggregate_rpc.sql
--
-- Policy aggregate window query, exposed as an RPC for the policy
-- gate's production wiring to call via supabase.rpc(...).
--
-- Replaces a hardcoded { sum: 0, count: 0 } stub in
-- src/lib/policy/gate/production-wiring.ts that was silently
-- bypassing every trailing-window rule and splitting guard.
-- Filter semantics match buildAggregateQuerySql() in
-- src/lib/policy/aggregate-detector/queries.ts 1:1 so the behavior
-- moving from stub → real is a pure "switch the runQuery adapter"
-- swap. Any bugs in the filter logic are preserved and tracked
-- separately (see the header comment in queries.ts for the known
-- initiator-field mismatch).
-- ============================================================

CREATE OR REPLACE FUNCTION public.policy_aggregate_window(
  p_enterprise_id          UUID,
  p_window_start           TIMESTAMPTZ,
  p_window_end             TIMESTAMPTZ,
  p_direction              TEXT,
  p_initiator_id           TEXT DEFAULT NULL,
  p_counterparty_id        TEXT DEFAULT NULL,
  p_destination_identity   TEXT DEFAULT NULL,
  p_asset                  TEXT DEFAULT NULL
)
RETURNS TABLE (
  sum_amount_usd            NUMERIC,
  count                     INT,
  distinct_destinations     INT,
  distinct_counterparties   INT,
  included_evaluation_ids   UUID[]
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM((proposed_movement->'amount'->>'amount_usd')::numeric), 0)::numeric
      AS sum_amount_usd,
    COUNT(*)::int AS count,
    COUNT(DISTINCT proposed_movement->'destination'->>'address')::int
      AS distinct_destinations,
    COUNT(DISTINCT proposed_movement->'counterparty'->>'id')::int
      AS distinct_counterparties,
    COALESCE(
      ARRAY_AGG(id) FILTER (WHERE id IS NOT NULL),
      ARRAY[]::UUID[]
    ) AS included_evaluation_ids
  FROM policy_evaluations
  WHERE enterprise_id = p_enterprise_id
    AND verdict = 'allow_auto'
    AND executed_at IS NOT NULL
    AND executed_at >= p_window_start
    AND executed_at <  p_window_end
    AND (
      p_direction = 'both'
      OR proposed_movement->'metadata'->>'direction' = p_direction
      OR proposed_movement->'metadata'->>'direction' IS NULL
    )
    AND (
      p_initiator_id IS NULL
      OR proposed_movement->'initiator'->>'user_id' = p_initiator_id
    )
    AND (
      p_counterparty_id IS NULL
      OR proposed_movement->'counterparty'->>'id' = p_counterparty_id
    )
    AND (
      p_destination_identity IS NULL
      OR (
        proposed_movement->'destination'->>'venue' || ':' ||
        COALESCE(
          proposed_movement->'destination'->>'address',
          proposed_movement->'destination'->>'account_id',
          ''
        )
      ) = p_destination_identity
    )
    AND (
      p_asset IS NULL
      OR proposed_movement->'amount'->>'asset' = p_asset
    );
$$;

COMMENT ON FUNCTION public.policy_aggregate_window IS
  'Policy gate trailing-window aggregate. Callers: policy gate production wiring. See src/lib/policy/aggregate-detector/queries.ts for the type contract.';

-- Supporting index for the hot filter combination (enterprise_id,
-- final_verdict, executed_at). Partial index keeps it small — only
-- executed allow_auto rows contribute to aggregates.
CREATE INDEX IF NOT EXISTS policy_evaluations_enterprise_window_idx
  ON policy_evaluations (enterprise_id, executed_at)
  WHERE executed_at IS NOT NULL AND verdict = 'allow_auto';

-- service_role bypasses RLS anyway; grant for explicit intent so any
-- future code path that uses the authenticated role also works.
GRANT EXECUTE ON FUNCTION public.policy_aggregate_window TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
