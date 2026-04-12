import { Condition } from '../types/ir';
import { HardLimitType, HardLimitScope, HardLimit } from '../types/hard-limit';
import { Verdict, ApprovalSlotRequirement } from '../types/verdict';
import { PolicyVersionSnapshot, PolicyRule, ApprovalChain } from '../types/policy-version';
import { UserRole } from '@/types/database';

export interface AuthoringActor {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
}

export interface CreateDraftRequest {
  name: string;
  source_version_id?: string;
}

export interface UpsertRuleRequest {
  id?: string;
  rule_type: PolicyRule['rule_type'];
  name: string;
  rationale: string;
  condition: Condition;
  verdict: Verdict;
  verdict_chain_id?: string;
  priority: number;
}

export interface UpsertHardLimitRequest {
  id?: string;
  limit_type: HardLimitType;
  name: string;
  limit_value: string;
  limit_currency?: string;
  scope: HardLimitScope;
}

export interface UpsertApprovalChainRequest {
  id?: string;
  name: string;
  slots: ApprovalSlotRequirement[];
  trigger_condition?: Condition;
  priority: number;
  expiration_hours?: number;
}

export interface ActivateRequest {
  reason: string;
}

export interface PolicyVersionResponse extends PolicyVersionSnapshot {
  created_by_email?: string;
  activated_by_email?: string;
  is_editable: boolean;
}

export interface VersionDiff {
  from_version_id: string;
  to_version_id: string;
  rules: {
    added: PolicyRule[];
    removed: PolicyRule[];
    modified: Array<{ before: PolicyRule; after: PolicyRule; changed_fields: string[] }>;
  };
  hard_limits: {
    added: HardLimit[];
    removed: HardLimit[];
    modified: Array<{ before: HardLimit; after: HardLimit; changed_fields: string[] }>;
  };
  approval_chains: {
    added: ApprovalChain[];
    removed: ApprovalChain[];
    modified: Array<{ before: ApprovalChain; after: ApprovalChain; changed_fields: string[] }>;
  };
}

export interface SatisfiabilityResult {
  version_id: string;
  all_satisfiable: boolean;
  chain_results: Array<{
    chain_id: string;
    chain_name: string;
    satisfiable: boolean;
    unsatisfied_slots?: Array<{ slot_index: number; minimum_role: string; required_count: number; available_count: number }>;
  }>;
}
