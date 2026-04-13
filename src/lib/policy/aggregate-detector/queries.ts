// src/lib/policy/aggregate-detector/queries.ts

import { WindowSpec } from '../types/ir';
import { ProposedMovement } from '../types/movement';

/**
 * Parameters passed to the query executor. The actual SQL execution
 * happens via a dependency-injected runQuery function — the detector
 * doesn't import a Supabase client directly so it stays testable.
 */
export interface AggregateQueryParams {
  enterpriseId: string;
  window: WindowSpec;
  movement: ProposedMovement;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Raw result returned by runQuery — just the numeric values. The detector
 * wraps this with window metadata to produce an AggregateWindowResult.
 */
export interface RawAggregateResult {
  sum_amount_usd: string;
  sum_amount_by_asset: Record<string, string>;
  count: number;
  distinct_destinations: number;
  distinct_counterparties: number;
  included_evaluation_ids: string[];
}

/**
 * The query function signature. Plan 2 supplies a real implementation
 * that hits policy_evaluations via the Supabase service client. Tests
 * supply a mock.
 */
export type RunAggregateQuery = (params: AggregateQueryParams) => Promise<RawAggregateResult>;

/**
 * Build the SQL for an aggregate window query. This is exported for Plan 2
 * to import when wiring up the real database client.
 *
 * PHASE-1 DESIGN NOTES:
 * - Filters by `verdict = 'allow_auto'` — this means manually-approved
 *   executed transfers are NOT counted toward trailing aggregates. A user
 *   structuring around a rule via manual approval would evade the splitting
 *   guard. Plan 2 should widen this to include all executed verdicts if
 *   "trailing outflow" is meant to reflect actual money movement.
 * - `direction` is inlined into the SQL string (not parameterized) but is
 *   constrained to 'outflow'|'inflow'|'both' via WindowSpec's closed union
 *   type. Runtime bypass requires an `as any` cast — acceptable risk for
 *   phase 1 on trusted internal callers.
 * - No LIMIT — large 30d windows on active treasuries could return many
 *   rows. The aggregation happens in Postgres so memory is bounded, but
 *   query time may need index tuning.
 */
export function buildAggregateQuerySql(
  params: AggregateQueryParams,
): { sql: string; bindings: unknown[] } {
  const { enterpriseId, window, movement, windowStart, windowEnd } = params;
  const direction = window.direction ?? 'outflow';

  // Build GROUP BY / WHERE clauses based on dimensions
  const groupFilters: string[] = [];
  const bindings: unknown[] = [enterpriseId, windowStart.toISOString(), windowEnd.toISOString()];

  if (window.group_by.initiator) {
    groupFilters.push(`proposed_movement->'initiator'->>'user_id' = $${bindings.length + 1}`);
    // Discriminated union — use exhaustive switch so adding a 5th Initiator
    // type is a compile error here rather than a silent fallthrough
    bindings.push(extractInitiatorIdentity(movement));
  }
  if (window.group_by.counterparty && movement.counterparty) {
    groupFilters.push(`proposed_movement->'counterparty'->>'id' = $${bindings.length + 1}`);
    bindings.push(movement.counterparty.id);
  }
  // Note: if window.group_by.counterparty is true but movement.counterparty
  // is undefined, the filter is NOT emitted here. The detector checks this
  // invariant upstream in runOne() and short-circuits to a structured
  // failure before reaching this builder, so any call that reaches this
  // point with that condition is a caller bug.
  if (window.group_by.destination) {
    const destIdentity = `${movement.destination.venue}:${movement.destination.address ?? movement.destination.account_id ?? ''}`;
    groupFilters.push(
      `(proposed_movement->'destination'->>'venue' || ':' || COALESCE(proposed_movement->'destination'->>'address', proposed_movement->'destination'->>'account_id', '')) = $${bindings.length + 1}`,
    );
    bindings.push(destIdentity);
  }
  if (window.group_by.asset) {
    groupFilters.push(`proposed_movement->'amount'->>'asset' = $${bindings.length + 1}`);
    bindings.push(movement.amount.asset);
  }

  const directionFilter =
    direction === 'both'
      ? ''
      : `AND (proposed_movement->'metadata'->>'direction' = '${direction}' OR proposed_movement->'metadata'->>'direction' IS NULL)`;

  const sql = `
    SELECT
      COALESCE(SUM((proposed_movement->'amount'->>'amount_usd')::numeric), 0)::text AS sum_amount_usd,
      COUNT(*)::int AS count,
      COUNT(DISTINCT proposed_movement->'destination'->>'address')::int AS distinct_destinations,
      COUNT(DISTINCT proposed_movement->'counterparty'->>'id')::int AS distinct_counterparties,
      ARRAY_AGG(id) AS included_evaluation_ids
    FROM policy_evaluations
    WHERE enterprise_id = $1
      AND verdict = 'allow_auto'
      AND executed_at IS NOT NULL
      AND executed_at >= $2
      AND executed_at <  $3
      ${directionFilter}
      ${groupFilters.length > 0 ? 'AND ' + groupFilters.join(' AND ') : ''}
  `;

  return { sql, bindings };
}

/**
 * Exhaustive discriminated-union unpacker for the Initiator type.
 * Returns the identity field appropriate for each initiator kind.
 * Adding a 5th Initiator kind triggers a compile error on the assertNever.
 */
function extractInitiatorIdentity(movement: ProposedMovement): string {
  const init = movement.initiator;
  switch (init.type) {
    case 'human':
      return init.user_id;
    case 'agent':
      return init.agent_id;
    case 'ai_recommendation':
      return init.recommendation_id;
    case 'schedule':
      return init.scheduled_op_id;
    default:
      return assertNeverInitiator(init);
  }
}

function assertNeverInitiator(x: never): never {
  throw new Error(`Unhandled Initiator type: ${JSON.stringify(x)}`);
}
