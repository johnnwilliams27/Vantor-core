// src/lib/policy/executor/executors/disabled-kinds.ts
//
// Executors for movement kinds whose route-level POST is currently
// 501-disabled (swap, bridge, payment). These cannot be approved through
// normal flows today, but if a rogue code path created an approval
// request for one of these kinds, the executor should refuse clearly
// rather than silently no-op.
//
// When the route is re-enabled, each of these is replaced with a real
// executor following the yield/ramp pattern.

import type { Executor, ExecuteResult } from '../types';
import type { MovementKind } from '../../types/movement';

function buildDisabledExecutor(kind: MovementKind): Executor {
  return {
    async execute(): Promise<ExecuteResult> {
      return {
        status: 'failed',
        error: `Executor for kind '${kind}' is not implemented (route is currently disabled).`,
        notes: { kind, disabled: true },
      };
    },
    async deny(): Promise<void> {
      // No domain row to update (the disabled routes never inserted one),
      // so denial is a no-op.
    },
  };
}

export const swapExecutor: Executor = buildDisabledExecutor('swap');
export const bridgeExecutor: Executor = buildDisabledExecutor('bridge');
export const paymentExecutor: Executor = buildDisabledExecutor('payment');
