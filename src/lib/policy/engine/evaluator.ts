// src/lib/policy/engine/evaluator.ts

import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';
import { EvaluationResult } from '../types/verdict';
import {
  EvaluationTrace,
  RuleEvaluationTrace,
  CanonicalizationTrace,
  ReasonCodeEntry,
} from '../types/trace';
import { HardLimitChecker } from '../hard-limit-checker/checker';
import { HardLimitCheckResult } from '../types/hard-limit';
import { evalCondition } from '../ir-evaluator/evaluator';
import { composeVerdict } from '../verdict-composer/composer';
import { REASON_CODES } from '../errors/reason-codes';

const ENGINE_VERSION = '1.0.0';

/**
 * Main policy engine evaluator. Pure, synchronous, deterministic given
 * a (movement, context) pair. The async context loader (Task 23) builds
 * the context; this evaluator only transforms (movement, context) →
 * EvaluationResult.
 *
 * Same function called by live evaluation (via the Plan 2 gate) and
 * simulation (via Plan 3 replay) — no parallel implementation.
 *
 * PHASE-1 GAP: `required_chain` on the returned EvaluationResult is
 * NOT populated. Chain selection lives in Plan 2 where the gate
 * consumes this result, matches rules to approval chains via rule
 * verdict_chain_id, and populates required_chain before persisting
 * to policy_evaluations. The engine itself doesn't know about chains.
 */
export class EvaluationEngine {
  private readonly hardLimitChecker: HardLimitChecker;

  constructor(hardLimitChecker?: HardLimitChecker) {
    this.hardLimitChecker = hardLimitChecker ?? new HardLimitChecker();
  }

  evaluate(movement: ProposedMovement, ctx: EvaluationContext): EvaluationResult {
    const startTime = Date.now();

    // Step 1: Hard limit check — runs first, terminal on breach at composition time
    const hardLimitCheckResult = this.hardLimitChecker.check(movement, ctx);

    // Step 2: Evaluate every user rule. We walk all rules (even after
    // finding a match or a failure) so the trace shows every rule that
    // was considered — complete audit trail.
    const rulesEvaluated: RuleEvaluationTrace[] = [];
    for (const rule of ctx.policy_version.rules) {
      rulesEvaluated.push(this.evaluateRule(rule, movement, ctx));
    }

    // Step 3: Check for hard limit evaluation failures BEFORE composing.
    // The HardLimitChecker's contract (checker.ts:27-30) explicitly says
    // the caller must treat `evaluated[].failure` as a block condition
    // separately from `any_breached`. A canonicalization hiccup that
    // prevents a min_cash_reserve_usd check from running MUST block the
    // transfer — otherwise the cash floor is silently unchecked and the
    // whole engine fails open on its load-bearing safety net.
    const failedHardLimits = hardLimitCheckResult.evaluated.filter((e) => e.failure !== undefined);
    if (failedHardLimits.length > 0 && !hardLimitCheckResult.any_breached) {
      // Fail-closed: force block. Don't call composeVerdict — we already
      // know the verdict, and the user rules' outcome is irrelevant when
      // we couldn't evaluate the floor/ceiling invariants.
      const trace = this.assembleTrace(
        ctx,
        movement,
        startTime,
        hardLimitCheckResult,
        rulesEvaluated,
        {
          verdict: 'block',
          source: 'hard_limit',
          invariants_applied: [],
        },
        this.buildHardLimitFailureReasons(failedHardLimits),
      );
      return {
        verdict: 'block',
        trace,
        reason_codes: trace.final_verdict_reasons.map((r) => r.reason_code),
      };
    }

    // Step 4: Compose final verdict with system invariants
    const composition = composeVerdict(
      movement,
      rulesEvaluated,
      hardLimitCheckResult.any_breached,
    );

    // Step 5: Build reason codes list — ONLY from hard limit breaches
    // and actual rule failures (never from rule-matched blocks or from
    // system invariants — those have their own fields on the trace).
    const reasonCodes = this.buildReasonCodes(
      composition.verdict,
      hardLimitCheckResult,
      rulesEvaluated,
    );

    // Step 6: Assemble the full trace and return
    const trace = this.assembleTrace(
      ctx,
      movement,
      startTime,
      hardLimitCheckResult,
      rulesEvaluated,
      composition,
      reasonCodes,
    );

    return {
      verdict: composition.verdict,
      trace,
      reason_codes: reasonCodes.map((r) => r.reason_code),
    };
  }

  /**
   * Assemble the full EvaluationTrace. Extracted so the step-3
   * early-return (hard limit failures → block) can share the same
   * trace-building logic as the normal step-6 path.
   */
  private assembleTrace(
    ctx: EvaluationContext,
    movement: ProposedMovement,
    startTime: number,
    hardLimitCheckResult: HardLimitCheckResult,
    rulesEvaluated: RuleEvaluationTrace[],
    composition: ReturnType<typeof composeVerdict>,
    reasonCodes: ReasonCodeEntry[],
  ): EvaluationTrace {
    // Defensive: guard against Invalid Date on rate_as_of. The canonicalizer
    // should never produce one (Task 9 hardening), but .toISOString() throws
    // RangeError on NaN timestamps — a single unguarded call here would
    // crash the whole engine.
    let rateAsOfIso: string;
    const rateMs = ctx.canonicalization.rate_as_of.getTime();
    if (Number.isFinite(rateMs)) {
      rateAsOfIso = ctx.canonicalization.rate_as_of.toISOString();
    } else {
      rateAsOfIso = '1970-01-01T00:00:00.000Z'; // sentinel
    }

    const canonicalizationTrace: CanonicalizationTrace = {
      native_amount: ctx.canonicalization.native_amount,
      native_asset: ctx.canonicalization.native_asset,
      canonical_amount: ctx.canonicalization.canonical_amount,
      canonical_currency: ctx.canonicalization.canonical_currency,
      rate: ctx.canonicalization.rate,
      rate_source: ctx.canonicalization.rate_source,
      rate_as_of: rateAsOfIso,
      max_age_ms: ctx.canonicalization.max_age_ms,
      succeeded: !ctx.canonicalization.failure,
      failure_reason_code: ctx.canonicalization.failure?.reason_code,
    };

    return {
      engine_version: ENGINE_VERSION,
      policy_version_id: ctx.policy_version.id,
      policy_version_number: ctx.policy_version.version_number,
      proposed_movement_id: movement.id,
      canonicalization: canonicalizationTrace,
      hard_limit_check: hardLimitCheckResult,
      rules_evaluated: rulesEvaluated,
      system_invariants_applied: composition.invariants_applied,
      final_verdict: composition.verdict,
      final_verdict_source: composition.source,
      final_verdict_reasons: reasonCodes,
      forecast_mode: ctx.forecast.query_metadata.mode,
      forecast_warnings: ctx.forecast.query_metadata.warnings,
      evaluation_duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Build reason code entries for hard limit evaluation failures (as
   * distinct from breaches). Called only when the engine short-circuits
   * to block due to unable-to-evaluate hard limits.
   */
  private buildHardLimitFailureReasons(
    failedLimits: HardLimitCheckResult['evaluated'],
  ): ReasonCodeEntry[] {
    return failedLimits.map((limit) => ({
      reason_code: limit.failure!.reason_code,
      human_readable: limit.failure!.human_readable,
      details: {
        ...limit.failure!.details,
        limit_name: limit.limit_name,
        limit_type: limit.limit_type,
      },
      user_action: limit.failure!.user_action,
    }));
  }

  /**
   * Evaluate a single rule, wrapping evalCondition in a try/catch as
   * defense in depth. The IR leaf evaluators have a never-throws contract
   * (they return structured LeafResult.failure on any problem), but if
   * a programmer-error assertNever fires the engine must not crash the
   * whole evaluation — the failing rule becomes a rule-level failure and
   * the verdict composer blocks the transfer.
   */
  private evaluateRule(
    rule: EvaluationContext['policy_version']['rules'][number],
    movement: ProposedMovement,
    ctx: EvaluationContext,
  ): RuleEvaluationTrace {
    let leafResult;
    try {
      leafResult = evalCondition(rule.condition, movement, ctx, [rule.id]);
    } catch (err) {
      return {
        rule_id: rule.id,
        rule_name: rule.name,
        rule_type: rule.rule_type,
        priority: rule.priority,
        condition_result: {
          path: [rule.id],
          node_kind: rule.condition.kind,
          result: 'failed',
          details: { uncaught_error: err instanceof Error ? err.message : String(err) },
        },
        matched: false,
        verdict_contribution: null,
        failure: {
          reason_code: 'condition_node_evaluation_failed',
          human_readable: `Rule '${rule.name}' crashed during evaluation: ${err instanceof Error ? err.message : String(err)}`,
          details: {
            rule_id: rule.id,
            error_class: err instanceof Error ? err.name : typeof err,
          },
          affected_condition_path: [rule.id],
          user_action:
            'This indicates a bug in the policy engine. Contact support with the trace ID.',
        },
      };
    }

    return {
      rule_id: rule.id,
      rule_name: rule.name,
      rule_type: rule.rule_type,
      priority: rule.priority,
      condition_result: {
        path: [rule.id],
        node_kind: rule.condition.kind,
        result: leafResult.failure ? 'failed' : leafResult.matched ? 'matched' : 'not_matched',
        details: leafResult.evaluation_details,
      },
      matched: leafResult.matched,
      matched_via: leafResult.via,
      // Only contribute a verdict when the rule matched cleanly. Failed
      // rules have verdict_contribution=null; the composer's step 2 catches
      // failures before step 3's privilege composition.
      verdict_contribution: leafResult.matched && !leafResult.failure ? rule.verdict : null,
      failure: leafResult.failure
        ? {
            reason_code: leafResult.failure.reason_code,
            human_readable: leafResult.failure.human_readable,
            details: leafResult.failure.details,
            affected_condition_path: [rule.id],
            user_action: leafResult.failure.user_action,
          }
        : undefined,
    };
  }

  /**
   * Build the structured reason_codes list attached to the final verdict.
   *
   * Populated ONLY from:
   * - Hard limit breaches (when verdict === 'block_hard_limit')
   * - Actual rule-level failures (when verdict === 'block' due to
   *   cannot-fully-evaluate)
   *
   * NOT populated from:
   * - Rule-matched blocks — these are explained by `trace.rules_evaluated`;
   *   the matched rule's name + rationale is the user-facing explanation.
   * - System invariants (ai_initiator_floor, default_deny) — these are
   *   explained by `trace.system_invariants_applied`, which carries
   *   warning codes, not reason codes.
   */
  private buildReasonCodes(
    verdict: EvaluationResult['verdict'],
    hardLimitResult: HardLimitCheckResult,
    ruleTraces: RuleEvaluationTrace[],
  ): ReasonCodeEntry[] {
    const entries: ReasonCodeEntry[] = [];

    if (verdict === 'block_hard_limit') {
      for (const breach of hardLimitResult.breaches) {
        entries.push({
          reason_code: REASON_CODES.hard_limit_breached,
          human_readable: breach.human_readable,
          details: {
            limit_name: breach.limit_name,
            limit_type: breach.limit_type,
            limit_value: breach.limit_value,
            post_transfer_value: breach.post_transfer_value,
            overage: breach.overage,
          },
          user_action: breach.user_action,
        });
      }
      return entries;
    }

    if (verdict === 'block') {
      // Block may be from: (a) a rule failure (cannot-fully-evaluate), or
      // (b) a rule matching with verdict=block. Only the failure case
      // produces structured reason codes — rule-matched blocks are
      // explained by the trace's rules_evaluated array.
      for (const rule of ruleTraces) {
        if (rule.failure) {
          entries.push({
            reason_code: rule.failure.reason_code,
            human_readable: rule.failure.human_readable,
            details: rule.failure.details,
            user_action: rule.failure.user_action,
          });
        }
      }
    }

    return entries;
  }
}
