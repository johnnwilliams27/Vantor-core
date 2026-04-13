// src/lib/policy/executor/types.ts
//
// Executor registry contract. One Executor per MovementKind. The approval
// HTTP routes call the registry AFTER the service records an approved/denied
// state transition — the executor is responsible for the side-effect work
// (adapter calls, domain-row status updates) that was held up pending
// approval.
//
// Service: state machine on policy_approval_requests.
// Executor: side-effects on the domain row (transfers, yield_transactions,
//           fiat_transactions, scheduled_operations).
//
// This separation keeps the approval service testable without pulling in
// the adapter layer and keeps the domain-row update logic next to the
// domain that owns it conceptually.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MovementKind, ProposedMovement } from '../types/movement';
import type { ApprovalRequest } from '../approvals/types';

/**
 * Why the held movement is being rolled back. Kept deliberately open
 * (string) rather than a closed union because the set of reasons spans
 * approval denials (manual / stale_reeval / expired), user retractions
 * (cancelled), and executor-internal checks that may be added later.
 * The domain row's `denial_reason` TEXT column is capped at 200 chars.
 */
export type ExecutorDenyReason =
  | 'manual'
  | 'stale_reeval'
  | 'expired'
  | 'cancelled'
  | (string & {}); // allow future reasons without widening the closed union

export type SupabaseLike = Pick<SupabaseClient, 'from'>;

/**
 * Outcome of running the executor's `execute()` on a movement. `status`
 * captures the terminal state of the DOMAIN row (not the approval row),
 * since the approval is already `executed` by the time we get here.
 *
 * `completed` / `pending` / `failed` are the common terminal states across
 * domains. `not_applicable` is used by crypto_transfer where execution
 * happens later via client-signed /confirm — the executor no-ops.
 */
export type ExecuteStatus = 'completed' | 'pending' | 'failed' | 'not_applicable';

export interface ExecuteResult {
  status: ExecuteStatus;
  /** Machine-readable summary for approval.resolution_notes. */
  notes: Record<string, unknown>;
  /** Human-readable error message, when status='failed'. */
  error?: string;
}

/**
 * Dependencies that every executor needs. Kept explicit (not hidden in a
 * service locator) so tests can swap these without module-level mocks.
 */
export interface ExecutorDeps {
  supabase: SupabaseLike;
}

export interface Executor {
  /**
   * Invoked when an approval reaches `executed` status. The executor
   * performs the held work (adapter call, position upsert, etc.) and
   * updates the domain row to its terminal state.
   *
   * Must be idempotent: the approval may be retried from the UI if the
   * HTTP call dropped. Re-running on an already-completed row should
   * return the existing result.
   */
  execute(
    movement: ProposedMovement,
    request: ApprovalRequest,
    deps: ExecutorDeps,
  ): Promise<ExecuteResult>;

  /**
   * Invoked when an approval transitions to `denied` (manual or stale_reeval).
   * Flips the domain row to `denied` with the supplied reason. Must be
   * idempotent. Returns nothing — denial has no adapter side effect.
   */
  deny(
    movement: ProposedMovement,
    request: ApprovalRequest,
    denialReason: ExecutorDenyReason,
    deps: ExecutorDeps,
  ): Promise<void>;
}

export type ExecutorRegistry = Record<MovementKind, Executor>;
