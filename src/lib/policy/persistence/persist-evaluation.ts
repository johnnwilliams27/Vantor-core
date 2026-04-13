// src/lib/policy/persistence/persist-evaluation.ts
//
// Append-only persistence of every gate-run evaluation to
// policy_evaluations. This is the data source the aggregate detector
// queries on future runs — without these rows, trailing-window rules
// and the splitting guard have nothing to aggregate.
//
// Contract:
//   - Runs after engine.evaluate() returns.
//   - Persists verdict / trace / canonicalization / reason_codes + the
//     full proposed_movement and context_snapshot for forensic replay.
//   - executed_at is NULL at insert time. Populated later by
//     markPolicyEvaluationExecuted when the movement actually executes.
//   - approval_request_id is NULL. The approval row carries movement_id,
//     so we join from the approval side when needed.
//   - Non-fatal: failures must not bubble up and fail the gate decision.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProposedMovement } from '../types/movement';
import type { EvaluationResult } from '../types/verdict';
import type { EvaluationContext } from '../types/context';

export interface PersistEvaluationParams {
  movement: ProposedMovement;
  enterpriseId: string;
  ctx: EvaluationContext;
  result: EvaluationResult;
}

export async function persistEvaluation(
  supabase: SupabaseClient,
  params: PersistEvaluationParams,
): Promise<void> {
  const { movement, enterpriseId, ctx, result } = params;

  const versionId = ctx.policy_version.id;
  // Guard: the "no policy configured" snapshot uses the sentinel UUID.
  // policy_evaluations.version_id has an FK to policy_versions — inserting
  // the sentinel would fail. Skip persistence in that case; there's
  // nothing meaningful to audit (no rules, guaranteed allow_auto).
  if (versionId === '00000000-0000-0000-0000-000000000000') {
    return;
  }

  const row = {
    enterprise_id: enterpriseId,
    version_id: versionId,
    movement_id: movement.id,
    proposed_movement: movement as unknown as Record<string, unknown>,
    context_snapshot: ctx as unknown as Record<string, unknown>,
    verdict: result.verdict,
    trace: result.trace as unknown as Record<string, unknown>,
    canonicalization: ctx.canonicalization as unknown as Record<string, unknown>,
    reason_codes: result.reason_codes ?? [],
  };

  const { error } = await (supabase.from('policy_evaluations') as any).insert(row);

  if (error) {
    throw new Error(`persistEvaluation insert failed: ${error.message}`);
  }
}

/**
 * Called after a gated movement actually executes (adapter success,
 * client-signed /confirm, scheduled-op cron success). Populates
 * executed_at + execution_ref so the aggregate detector can include
 * the row in trailing-window sums.
 *
 * Idempotent — running on an already-marked row overwrites with the
 * same values. Non-fatal — logs but doesn't throw, because the
 * movement already completed; losing the history timestamp is
 * inconvenient but not broken.
 *
 * Defense-in-depth: scopes WHERE to (movement_id, enterprise_id) —
 * a rogue caller cannot update another tenant's row via a known
 * movement_id alone.
 */
export async function markPolicyEvaluationExecuted(
  supabase: SupabaseClient,
  params: {
    movementId: string;
    enterpriseId: string;
    executionRef?: string | null;
  },
): Promise<void> {
  const { movementId, enterpriseId, executionRef } = params;

  const { error } = await (supabase.from('policy_evaluations') as any)
    .update({
      executed_at: new Date().toISOString(),
      execution_ref: executionRef ?? null,
    })
    .eq('movement_id', movementId)
    .eq('enterprise_id', enterpriseId);

  if (error) {
    console.error('[policy] markPolicyEvaluationExecuted failed', {
      movement_id: movementId,
      enterprise_id: enterpriseId,
      error: error.message,
    });
  }
}
