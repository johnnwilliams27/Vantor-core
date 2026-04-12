// src/lib/policy/approvals/types.ts

import type { UserRole } from '@/types/database';
import type { ProposedMovement } from '../types/movement';
import type { ResolvedApprovalChain } from '../types/verdict';

// ─── Enums ─────────────────────────────────────────────────────────────

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'executed'
  | 'denied'
  | 'escalated'
  | 'cancelled';

export type DenialReason = 'manual' | 'expired' | 'stale_reeval';

// ─── Slot assignments ──────────────────────────────────────────────────

export interface SlotAssignment {
  slot_index: number;
  minimum_role: string;
  filled_by?: string;
  filled_at?: string;
  justification?: string;
}

// ─── DB row shape ──────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  enterprise_id: string;
  version_id: string;
  movement_id: string;
  proposed_movement: ProposedMovement;
  triggered_rule_ids: string[];
  chain_id: string;
  slot_assignments: SlotAssignment[];
  status: ApprovalStatus;
  denial_reason?: DenialReason;
  expires_at: string;
  created_by?: string;
  created_at: string;
  approved_at?: string;
  resolved_at?: string;
  resolution_notes?: unknown;
  version: number;
}

// ─── Input DTOs ────────────────────────────────────────────────────────

export interface CreateApprovalInput {
  enterprise_id: string;
  version_id: string;
  movement_id: string;
  proposed_movement: ProposedMovement;
  chain: ResolvedApprovalChain;
  triggered_rule_ids: string[];
  created_by?: string;
}

export interface ApprovalActor {
  user_id: string;
  role: UserRole;
  enterprise_id: string;
}

export interface ListFilters {
  status?: ApprovalStatus;
  limit?: number;
  cursor?: string;
}
