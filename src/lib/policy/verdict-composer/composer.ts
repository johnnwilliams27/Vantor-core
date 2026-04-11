// src/lib/policy/verdict-composer/composer.ts

import { Verdict } from '../types/verdict';
import { ProposedMovement } from '../types/movement';
import { RuleEvaluationTrace, SystemInvariantTrace } from '../types/trace';
import { WARNING_CODES } from '../errors/reason-codes';

export interface ComposeVerdictResult {
  verdict: Verdict;
  source: 'hard_limit' | 'user_rule' | 'system_invariant' | 'default_deny';
  invariants_applied: SystemInvariantTrace[];
}

/**
 * Compose the final verdict from the set of rule evaluations + hard limit
 * check result + system invariants.
 *
 * Precedence spec:
 *
 *   1. Hard limit breach → 'block_hard_limit' (terminal, cannot be
 *      overridden by any rule or invariant)
 *   2. Cannot-fully-evaluate: if ANY rule failed to evaluate, return 'block'
 *      (never silently approve a rule we couldn't check)
 *   3. Lowest-privilege wins among matching rules:
 *      block/block_hard_limit > require_approval > allow_auto
 *   4. AI-initiator floor: promotes allow_auto → require_approval when the
 *      movement's initiator is 'ai_recommendation' or 'agent'. This
 *      enforces Vantor's invariant "AI-initiated money movement never
 *      auto-executes" regardless of what the user rules say.
 *   5. Default deny: non-human initiators with no matching rules →
 *      require_approval. A schedule-initiated or agent-initiated movement
 *      that no rule explicitly allowed must go through approval.
 *   6. Human initiator with no matching rules → allow_auto. Humans are
 *      trusted by default; rules are the mechanism for restricting them.
 */
export function composeVerdict(
  movement: ProposedMovement,
  ruleTraces: RuleEvaluationTrace[],
  hardLimitBreached: boolean,
): ComposeVerdictResult {
  const invariants: SystemInvariantTrace[] = [];

  // Step 1: hard limit breach wins — terminal
  if (hardLimitBreached) {
    return {
      verdict: 'block_hard_limit',
      source: 'hard_limit',
      invariants_applied: invariants,
    };
  }

  // Step 2: cannot-fully-evaluate → block
  const failedRules = ruleTraces.filter((r) => r.failure !== undefined);
  if (failedRules.length > 0) {
    return {
      verdict: 'block',
      source: 'user_rule',
      invariants_applied: invariants,
    };
  }

  // Step 3: lowest-privilege wins among matching rules
  const matchingRules = ruleTraces.filter((r) => r.matched && !r.failure);
  let composed: Verdict | null = null;

  // 'block' and 'block_hard_limit' from a user rule are both treated as
  // block (defense in depth — block_hard_limit is the hard-limit checker's
  // domain, but if a rule somehow contributes it, we don't want it to fall
  // through to allow_auto silently).
  if (
    matchingRules.some(
      (r) => r.verdict_contribution === 'block' || r.verdict_contribution === 'block_hard_limit',
    )
  ) {
    composed = 'block';
  } else if (matchingRules.some((r) => r.verdict_contribution === 'require_approval')) {
    composed = 'require_approval';
  } else if (matchingRules.some((r) => r.verdict_contribution === 'allow_auto')) {
    composed = 'allow_auto';
  }

  // Step 4: AI/agent initiator floor
  const initiatorType = movement.initiator.type;
  const isAutonomousInitiator =
    initiatorType === 'ai_recommendation' || initiatorType === 'agent';

  if (composed === 'allow_auto' && isAutonomousInitiator) {
    invariants.push({
      invariant: 'ai_initiator_floor',
      applied: true,
      warning_code: WARNING_CODES.ai_initiator_floor_applied,
      human_readable:
        `This movement would have auto-executed under the matching rules, but was held ` +
        `for approval because Vantor's system invariant requires human approval for all ` +
        `${initiatorType === 'ai_recommendation' ? 'AI-initiated' : 'agent-initiated'} transfers.`,
    });
    return {
      verdict: 'require_approval',
      source: 'system_invariant',
      invariants_applied: invariants,
    };
  }

  // Step 5: default deny for non-human initiators with no explicit allow
  if (composed === null && (isAutonomousInitiator || initiatorType === 'schedule')) {
    invariants.push({
      invariant: 'default_deny',
      applied: true,
      warning_code: WARNING_CODES.default_deny_triggered,
      human_readable:
        `No rule explicitly permitted this ${initiatorType}-initiated transfer. ` +
        `The default deny invariant for non-human initiators required approval.`,
    });
    return {
      verdict: 'require_approval',
      source: 'system_invariant',
      invariants_applied: invariants,
    };
  }

  // Step 6: human initiator with no matching rules → allow_auto
  // (trusted-by-default — rules are the restriction mechanism)
  if (composed === null) {
    return {
      verdict: 'allow_auto',
      // Source label is 'default_deny' from the type's closed union even
      // though semantically this is "default allow for humans". The type
      // doesn't carry a 'default_allow' variant; the invariants array is
      // empty, which signals the distinction for observers.
      source: 'default_deny',
      invariants_applied: invariants,
    };
  }

  return {
    verdict: composed,
    source: 'user_rule',
    invariants_applied: invariants,
  };
}
