// src/lib/policy/types/verdict.ts

import { ReasonCode } from '../errors/reason-codes';
import type { EvaluationTrace } from './trace';

/**
 * The four possible verdicts the engine can produce.
 *
 * - allow_auto: policy permits automatic execution (subject to system invariants)
 * - require_approval: must pass through the approval workflow before execution
 * - block: a user rule blocked this movement
 * - block_hard_limit: a structural hard limit breach; terminal, cannot be overridden
 */
export type Verdict = 'allow_auto' | 'require_approval' | 'block' | 'block_hard_limit';

/**
 * Result of a single evaluation. Built by the pure evaluator and persisted
 * to policy_evaluations (in Plan 2) via the gate.
 */
export interface EvaluationResult {
  verdict: Verdict;
  trace: EvaluationTrace;
  required_chain?: ResolvedApprovalChain;   // populated iff verdict='require_approval'
  reason_codes: ReasonCode[];                // in order of precedence
}

/**
 * Chain resolved for a require_approval verdict. The approval workflow
 * service (Plan 2) uses this to create an approval request.
 */
export interface ResolvedApprovalChain {
  chain_id: string;
  chain_name: string;
  slots: ApprovalSlotRequirement[];
  expiration_hours: number;
}

export interface ApprovalSlotRequirement {
  slot_index: number;
  minimum_role: ApproverRole;
  label?: string;
}

/**
 * Approver roles — re-exported from the single source of truth at
 * `src/lib/auth/roles.ts`. Canonical set:
 *   auditor | accountant | treasury_manager | executive
 * `enterprise_admin` is strictly excluded (separation of duties).
 * The legacy 'approver' literal was removed during RBAC consolidation.
 */
export type { ApproverRole } from '@/lib/auth/roles';
import type { ApproverRole } from '@/lib/auth/roles';
