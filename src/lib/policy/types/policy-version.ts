// src/lib/policy/types/policy-version.ts

import { Condition } from './ir';
import { HardLimit } from './hard-limit';
import { Verdict, ApprovalSlotRequirement } from './verdict';

/**
 * Fully-hydrated policy version as consumed by the evaluator.
 * Built by querying policy_versions + policy_rules + policy_hard_limits
 * + policy_approval_chains.
 */
export interface PolicyVersionSnapshot {
  id: string;
  enterprise_id: string;
  version_number: number;
  status: 'draft' | 'active' | 'superseded';
  name: string;
  activated_at?: Date;
  activated_by?: string;
  rules: PolicyRule[];
  hard_limits: HardLimit[];
  approval_chains: ApprovalChain[];
}

export interface PolicyRule {
  id: string;
  version_id: string;
  rule_type: 'approval_threshold' | 'counterparty' | 'time_window' | 'lookahead';
  name: string;
  rationale: string;
  condition: Condition;
  verdict: Verdict;
  verdict_chain_id?: string;
  priority: number;
  created_by: string;
  created_at: Date;
}

export interface ApprovalChain {
  id: string;
  version_id: string;
  name: string;
  slots: ApprovalSlotRequirement[];
  trigger_condition?: Condition;
  priority: number;
  expiration_hours: number;
  created_by: string;
  created_at: Date;
}
