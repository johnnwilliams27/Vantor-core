/**
 * Policy gate for the Treasury Insights Engine.
 *
 * Every actionable insight passes its `recommendedAction` through this
 * gate before surfacing. The gate calls the treasury policy engine's
 * `evaluate()` function and returns a verdict plus a reason the insight
 * stores alongside the recommendation.
 *
 * **Current state:** the treasury policy engine is being built in the
 * `feature/policy-engine` worktree. Its types (`Verdict`, `EvaluationResult`,
 * `EvaluationContext`) are defined there but not yet merged to master.
 * Until they land, this module uses a local stub that returns
 * `require_approval` for every action — which is correct per the policy
 * engine invariant that AI-initiated movements never auto-execute.
 *
 * When the policy engine lands on master, swap the stub for a real call
 * to `evaluate(movement, context)`. The insight-level interface does not
 * need to change: `evaluateInsightAction()` is the single call site.
 *
 * See plan file F5 for the full swap procedure.
 */

import type { PolicyVerdict, ProposedAction } from './types';

// ─── Stub-level result shape ──────────────────────────────────────────

/**
 * Minimal result shape the gate returns. Mirrors a subset of the policy
 * engine's `EvaluationResult` but only the fields insights consume:
 * verdict + reason. The real policy engine also returns `trace`,
 * `required_chain`, and `reason_codes`, which the insights engine does
 * NOT need for display (they're for the execution layer).
 */
export interface InsightPolicyResult {
  verdict: PolicyVerdict;
  reason: string;
}

// ─── Gate entry point ─────────────────────────────────────────────────

/**
 * Evaluate a proposed action against the policy engine.
 *
 * v1 behavior (stub): always returns `require_approval` with a clear
 * reason pointing at the stub. This is the safe conservative default —
 * it surfaces every actionable insight for treasurer review.
 *
 * v1.5 behavior (post-swap): calls `evaluate(movement, context)` from
 * `@/lib/policy/types` after the policy engine merges to master. The
 * swap is a one-line change in this file; no detector code changes.
 */
export async function evaluateInsightAction(
  action: ProposedAction,
): Promise<InsightPolicyResult> {
  // Explicit reference to `action` so the stub actually depends on its
  // argument — prevents the real swap from breaking if a detector passes
  // a malformed shape.
  void action;

  return {
    verdict: 'require_approval',
    reason:
      'Insights engine stub — policy evaluator not yet live. AI-initiated ' +
      'actions never auto-execute per policy engine invariant #3. The ' +
      'treasurer must review and approve every recommendation.',
  };
}

/**
 * Convenience: null-safe wrapper for detectors whose `recommendedAction`
 * is nullable. Returns null if no action (informational insight).
 */
export async function evaluateInsightActionOrNull(
  action: ProposedAction | null,
): Promise<InsightPolicyResult | null> {
  if (!action) return null;
  return evaluateInsightAction(action);
}
