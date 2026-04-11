// src/lib/policy/hard-limit-checker/utilization-probe.ts

import { HardLimitEvaluation } from '../types/hard-limit';
import { EvaluationContext } from '../types/context';
import { ProposedMovement } from '../types/movement';
import { HardLimitChecker } from './checker';

/**
 * Probes the current state of every hard limit WITHOUT a proposed
 * movement. Used by dashboard widgets and the Policy view's Hard
 * Guardrails block to show "current vs limit" gauges.
 *
 * Implemented as a thin wrapper around HardLimitChecker: constructs a
 * synthetic zero-amount movement and runs the checker. The resulting
 * `post_transfer_value` equals `current_value` for every limit (since
 * the zero-amount movement contributes no delta). Consumers read
 * `current_value` and `utilization_pct`.
 *
 * REQUIREMENT: callers must provide an EvaluationContext where
 * `canonicalization.canonical_amount === '0'` (or at least a valid
 * decimal string). The probe does not mutate the passed context; if
 * the caller supplies a context with an unrelated canonical amount,
 * the resulting post_transfer_value will be misleading.
 */
export class HardLimitUtilizationProbe {
  constructor(private readonly checker: HardLimitChecker = new HardLimitChecker()) {}

  probe(ctx: EvaluationContext): HardLimitEvaluation[] {
    const syntheticMovement: ProposedMovement = {
      id: 'probe',
      kind: 'crypto_transfer',
      source: { venue: 'probe', asset: 'USD' },
      destination: { venue: 'probe', asset: 'USD' },
      amount: { amount: '0', asset: 'USD' },
      initiator: { type: 'human', user_id: 'probe' },
      requested_at: new Date().toISOString(),
    };
    return this.checker.check(syntheticMovement, ctx).evaluated;
  }
}
