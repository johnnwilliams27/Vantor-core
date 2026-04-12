// src/lib/policy/gate/gate.ts

import { REASON_CODES } from '../errors/reason-codes';
import { GateError } from './errors';
import type { ProposedMovement } from '../types/movement';
import type { EvaluationResult } from '../types/verdict';
import type { UserRole } from '@/types/database';
import type {
  ApprovalRequest,
  ApprovalWorkflowService,
  EvaluateFn,
} from '../approvals';

// ─── Public types ──────────────────────────────────────────────────────

export type GateActor = {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
};

export type GateResult =
  | { verdict: 'allow_auto'; evaluation: EvaluationResult }
  | {
      verdict: 'require_approval';
      approval_request: ApprovalRequest;
      evaluation: EvaluationResult;
    };

export interface PolicyGateServiceOptions {
  evaluate: EvaluateFn;
  approvalService: ApprovalWorkflowService;
}

// ─── Supabase-like minimal shape (same pattern as ApprovalWorkflowService) ──

export type SupabaseLike = {
  from: (table: string) => unknown;
};

// ─── Service ───────────────────────────────────────────────────────────

/**
 * Gate a proposed money movement through the policy engine.
 *
 * - `allow_auto` → return `{ verdict: 'allow_auto', evaluation }`
 * - `require_approval` → create an ApprovalRequest and return it
 * - `block` / `block_hard_limit` → throw GateError (never returned)
 * - engine/approval errors → throw GateError with specific reason_code
 */
export class PolicyGateService {
  // Kept for API symmetry with ApprovalWorkflowService and future extensions
  // (e.g., direct DB lookups for denial audit). Currently unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private readonly supabase: SupabaseLike;
  private readonly evaluateFn: EvaluateFn;
  private readonly approvalService: ApprovalWorkflowService;

  constructor(supabase: SupabaseLike, options: PolicyGateServiceOptions) {
    this.supabase = supabase;
    this.evaluateFn = options.evaluate;
    this.approvalService = options.approvalService;
  }

  async gate(movement: ProposedMovement, actor: GateActor): Promise<GateResult> {
    // 1. Defense-in-depth: enterprise isolation. Route already filters
    //    by session enterprise, but bugs in the mapper or manual calls
    //    could lead to a mismatched movement.
    const movementEnterpriseId = this.readEnterpriseId(movement);
    if (movementEnterpriseId && movementEnterpriseId !== actor.enterprise_id) {
      throw new GateError({
        reason_code: REASON_CODES.enterprise_mismatch,
        human_readable: 'Movement enterprise does not match actor enterprise.',
        user_action: 'Contact support — this should not happen.',
        details: {
          movement_enterprise_id: movementEnterpriseId,
          actor_enterprise_id: actor.enterprise_id,
        },
      });
    }

    // 2. Run the engine. Wrap in try/catch to classify failures.
    let evaluation: EvaluationResult;
    try {
      evaluation = await this.evaluateFn(movement, actor.enterprise_id);
    } catch (err) {
      // Distinguish canonicalization-class failures from "engine is down".
      // Canonicalization errors are PolicyErrors thrown by the engine with
      // reason_code='canonicalization_failed'. Anything else is treated as
      // engine unavailability (503 upstream).
      if (this.isCanonicalizationError(err)) {
        throw new GateError({
          reason_code: REASON_CODES.canonicalization_failed,
          human_readable: 'Policy engine could not canonicalize the movement.',
          user_action: 'Check that the asset and rate feed are available.',
          details: { movement_id: movement.id },
          cause: err,
        });
      }
      throw new GateError({
        reason_code: REASON_CODES.policy_engine_unavailable,
        human_readable: 'Policy engine is temporarily unavailable.',
        user_action: 'Retry the transfer in a few seconds.',
        details: { movement_id: movement.id },
        cause: err,
      });
    }

    // 3. Dispatch on verdict.
    switch (evaluation.verdict) {
      case 'allow_auto':
        return { verdict: 'allow_auto', evaluation };

      case 'block':
        throw new GateError({
          reason_code: REASON_CODES.policy_blocked,
          human_readable: 'Transfer blocked by policy.',
          user_action:
            'Review the triggered rules or request a treasurer override.',
          details: {
            movement_id: movement.id,
            reason_codes: evaluation.reason_codes ?? [],
            trace: evaluation.trace,
          },
        });

      case 'block_hard_limit':
        throw new GateError({
          reason_code: REASON_CODES.hard_limit_breached,
          human_readable: 'Transfer would breach a hard limit.',
          user_action:
            'Wait until the limit window resets or request a manual override.',
          details: {
            movement_id: movement.id,
            reason_codes: evaluation.reason_codes ?? [],
            trace: evaluation.trace,
          },
        });

      case 'require_approval':
        return this.createApproval(movement, actor, evaluation);

      default: {
        // Exhaustiveness check for future verdicts.
        const _exhaustive: never = evaluation.verdict;
        throw new GateError({
          reason_code: REASON_CODES.gate_internal_error,
          human_readable: `Unhandled verdict: ${String(_exhaustive)}`,
          user_action: 'Contact support.',
          details: { movement_id: movement.id },
        });
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────

  private async createApproval(
    movement: ProposedMovement,
    actor: GateActor,
    evaluation: EvaluationResult,
  ): Promise<GateResult> {
    if (!evaluation.required_chain) {
      throw new GateError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable:
          'Policy returned require_approval but no approval chain was resolved.',
        user_action: 'Contact support — this is a policy configuration bug.',
        details: { movement_id: movement.id },
      });
    }

    try {
      const approval_request = await this.approvalService.createApprovalRequest({
        enterprise_id: actor.enterprise_id,
        version_id: this.readVersionId(evaluation),
        movement_id: movement.id,
        proposed_movement: movement,
        chain: evaluation.required_chain,
        triggered_rule_ids: this.readTriggeredRuleIds(evaluation),
        created_by: actor.user_id,
      });

      return { verdict: 'require_approval', approval_request, evaluation };
    } catch (err) {
      throw new GateError({
        reason_code: REASON_CODES.approval_creation_failed,
        human_readable: 'Could not create approval request.',
        user_action: 'Retry the transfer.',
        details: { movement_id: movement.id },
        cause: err,
      });
    }
  }

  /**
   * Best-effort extractor for `enterprise_id` from a ProposedMovement.
   * The type does not require it, but the mapper puts it in metadata.
   * Returns undefined if not present (skips the isolation check).
   */
  private readEnterpriseId(movement: ProposedMovement): string | undefined {
    const md = movement.metadata as Record<string, unknown> | undefined;
    const val = md?.enterprise_id;
    return typeof val === 'string' ? val : undefined;
  }

  /**
   * Extract the policy version id from the evaluation trace. The trace
   * shape is defined by Plan 1's EvaluationContext. Falls back to
   * 'unknown' for defensive completeness.
   */
  private readVersionId(evaluation: EvaluationResult): string {
    const trace = evaluation.trace as unknown as Record<string, unknown> | undefined;
    const versionId = trace?.policy_version_id;
    return typeof versionId === 'string' ? versionId : 'unknown';
  }

  /**
   * Extract the triggered rule ids from the evaluation trace.
   */
  private readTriggeredRuleIds(evaluation: EvaluationResult): string[] {
    const trace = evaluation.trace as unknown as Record<string, unknown> | undefined;
    const ids = trace?.triggered_rule_ids;
    return Array.isArray(ids) ? (ids as string[]) : [];
  }

  private isCanonicalizationError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const reasonCode = (err as { reason_code?: unknown }).reason_code;
    return reasonCode === REASON_CODES.canonicalization_failed;
  }
}
