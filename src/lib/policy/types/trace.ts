// src/lib/policy/types/trace.ts

import type { Verdict } from './verdict';
import { ReasonCode, WarningCode } from '../errors/reason-codes';
import { HardLimitCheckResult } from './hard-limit';
import { Condition } from './ir';
import type { PolicyRule } from './policy-version';

/**
 * Full evaluation trace persisted to policy_evaluations. Every rule
 * considered (even non-matching) and every system invariant applied
 * is recorded so the trace is a complete explanation of the verdict.
 */
export interface EvaluationTrace {
  engine_version: string;
  policy_version_id: string;
  policy_version_number: number;
  proposed_movement_id: string;

  canonicalization: CanonicalizationTrace;
  hard_limit_check: HardLimitCheckResult;
  rules_evaluated: RuleEvaluationTrace[];
  system_invariants_applied: SystemInvariantTrace[];

  final_verdict: Verdict;
  final_verdict_source: 'hard_limit' | 'user_rule' | 'system_invariant' | 'default_deny';
  final_verdict_reasons: ReasonCodeEntry[];

  forecast_mode: 'stub' | 'real';
  forecast_warnings: string[];

  evaluation_duration_ms: number;
}

export interface CanonicalizationTrace {
  native_amount: string;
  native_asset: string;
  canonical_amount: string;
  canonical_currency: 'USD';
  rate: string;
  rate_source: string;
  rate_as_of: string;
  max_age_ms: number;
  succeeded: boolean;
  failure_reason_code?: ReasonCode;
}

export interface RuleEvaluationTrace {
  rule_id: string;
  rule_name: string;
  rule_type: PolicyRule['rule_type'];
  priority: number;
  condition_result: ConditionEvaluationTrace;
  matched: boolean;
  matched_via?: 'direct' | 'splitting';
  verdict_contribution: Verdict | null;
  failure?: RuleEvaluationFailure;
}

export interface ConditionEvaluationTrace {
  path: (string | number)[];
  node_kind: Condition['kind'];
  result: 'matched' | 'not_matched' | 'failed';
  children?: ConditionEvaluationTrace[];
  details?: Record<string, unknown>;
}

export interface RuleEvaluationFailure {
  reason_code: ReasonCode;
  human_readable: string;
  details: Record<string, unknown>;
  affected_condition_path: (string | number)[];
  user_action?: string;
}

export interface SystemInvariantTrace {
  invariant: 'ai_initiator_floor' | 'splitting_guard' | 'default_deny';
  applied: boolean;
  warning_code: WarningCode;
  human_readable: string;
  details?: Record<string, unknown>;
}

export interface ReasonCodeEntry {
  reason_code: ReasonCode;
  human_readable: string;
  details?: Record<string, unknown>;
  user_action?: string;
}
