// src/lib/policy/executor/registry.ts
//
// Movement-kind → Executor dispatch. Used by the approval HTTP routes
// to run (or deny) the held domain-row work after an approval resolves.

import type { Executor, ExecutorRegistry, ExecutorDeps, ExecuteResult, SupabaseLike, ExecutorDenyReason } from './types';
import type { ProposedMovement } from '../types/movement';
import type { ApprovalRequest } from '../approvals/types';
import { cryptoTransferExecutor } from './executors/crypto-transfer';
import { yieldDepositExecutor } from './executors/yield-deposit';
import { yieldWithdrawExecutor } from './executors/yield-withdraw';
import { fiatRampExecutor } from './executors/fiat-ramp';
import { scheduledOperationExecutor } from './executors/scheduled-operation';
import { swapExecutor, bridgeExecutor, paymentExecutor } from './executors/disabled-kinds';

/**
 * Default registry wired with every live + disabled kind. Callers (route
 * handlers, tests) may swap executors by spreading over this map.
 */
export const defaultExecutorRegistry: ExecutorRegistry = {
  crypto_transfer: cryptoTransferExecutor,
  yield_deposit: yieldDepositExecutor,
  yield_withdraw: yieldWithdrawExecutor,
  fiat_ramp: fiatRampExecutor,
  // scheduled_operation is NOT in MovementKind — scheduled ops wrap an
  // inner kind via mapScheduledOperationToMovement, so movement.kind is
  // whatever the inner kind was (swap/bridge/ramp). To route a scheduled
  // op to the scheduled executor, we key on initiator.type === 'schedule'
  // in dispatchExecute/dispatchDeny below.
  swap: swapExecutor,
  bridge: bridgeExecutor,
  payment: paymentExecutor,
};

/**
 * Resolve the correct executor for a movement. Scheduled-op movements
 * (initiator.type === 'schedule') always use the scheduled-operation
 * executor regardless of inner kind — the row the executor updates is
 * scheduled_operations, not the inner domain table.
 */
export function resolveExecutor(
  movement: ProposedMovement,
  registry: ExecutorRegistry = defaultExecutorRegistry,
): Executor {
  if (movement.initiator.type === 'schedule') {
    return scheduledOperationExecutor;
  }
  const executor = registry[movement.kind];
  if (!executor) {
    // Defensive — MovementKind is a closed union so this should be
    // unreachable at compile time, but keep the runtime check so a
    // future expansion of MovementKind without a registry entry
    // surfaces loudly instead of corrupting state.
    throw new Error(`No executor registered for kind '${movement.kind}'.`);
  }
  return executor;
}

/**
 * Convenience: dispatch an `execute` call to the right executor. Used
 * by the /approvals/[id]/approve route.
 */
export async function dispatchExecute(
  movement: ProposedMovement,
  request: ApprovalRequest,
  supabase: SupabaseLike,
  registry?: ExecutorRegistry,
): Promise<ExecuteResult> {
  const executor = resolveExecutor(movement, registry);
  const deps: ExecutorDeps = { supabase };
  return executor.execute(movement, request, deps);
}

/**
 * Convenience: dispatch a `deny` call. Used by the approve path (when
 * reEvaluate comes back stale/blocked) and by the /deny route.
 */
export async function dispatchDeny(
  movement: ProposedMovement,
  request: ApprovalRequest,
  denialReason: ExecutorDenyReason,
  supabase: SupabaseLike,
  registry?: ExecutorRegistry,
): Promise<void> {
  const executor = resolveExecutor(movement, registry);
  const deps: ExecutorDeps = { supabase };
  await executor.deny(movement, request, denialReason, deps);
}
