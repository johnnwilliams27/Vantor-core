// src/lib/policy/approvals/service.ts

import { REASON_CODES } from '../errors/reason-codes';
import { ApprovalError } from './errors';
import type {
  ApprovalRequest,
  ApprovalActor,
  CreateApprovalInput,
  ListFilters,
  SlotAssignment,
} from './types';
import type { EvaluationResult } from '../types/verdict';
import type { ProposedMovement } from '../types/movement';
import { validateSoD } from './sod';

// ─── Minimal SupabaseLike type ──────────────────────────────────────────

export type SupabaseLike = {
  from: (table: string) => unknown;
};

// ─── DI for evaluate function ──────────────────────────────────────────

export type EvaluateFn = (
  movement: ProposedMovement,
  enterpriseId: string,
) => Promise<EvaluationResult>;

export interface ApprovalWorkflowServiceOptions {
  evaluate?: EvaluateFn;
}

// ─── Service ───────────────────────────────────────────────────────────

export class ApprovalWorkflowService {
  private readonly supabase: SupabaseLike;
  private readonly evaluateFn?: EvaluateFn;

  constructor(supabase: SupabaseLike, options?: ApprovalWorkflowServiceOptions) {
    this.supabase = supabase;
    this.evaluateFn = options?.evaluate;
  }

  // ─── Create ────────────────────────────────────────────────────────

  async createApprovalRequest(input: CreateApprovalInput): Promise<ApprovalRequest> {
    const table = this.supabase.from('policy_approval_requests') as any;

    // Idempotency: check for existing request with same movement_id
    const { data: existing } = await table
      .select('*')
      .eq('enterprise_id', input.enterprise_id)
      .eq('movement_id', input.movement_id)
      .maybeSingle();

    if (existing) {
      return existing as ApprovalRequest;
    }

    // Initialize slot assignments from chain (all unfilled)
    const slot_assignments: SlotAssignment[] = input.chain.slots.map((slot) => ({
      slot_index: slot.slot_index,
      minimum_role: slot.minimum_role,
    }));

    // Compute expiration
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + input.chain.expiration_hours * 60 * 60 * 1000,
    );

    const row = {
      enterprise_id: input.enterprise_id,
      version_id: input.version_id,
      movement_id: input.movement_id,
      proposed_movement: input.proposed_movement,
      triggered_rule_ids: input.triggered_rule_ids,
      chain_id: input.chain.chain_id,
      slot_assignments,
      status: 'pending' as const,
      expires_at: expiresAt.toISOString(),
      created_by: input.created_by,
      created_at: now.toISOString(),
      version: 0,
    };

    const { data: created, error } = await table.insert(row);
    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Failed to create approval request: ${error.message}`,
        user_action: 'Retry the operation.',
        details: { movement_id: input.movement_id },
        cause: error,
      });
    }

    return (Array.isArray(created) ? created[0] : created) as ApprovalRequest;
  }

  // ─── Read ──────────────────────────────────────────────────────────

  async getRequest(actor: ApprovalActor, requestId: string): Promise<ApprovalRequest> {
    const table = this.supabase.from('policy_approval_requests') as any;
    const { data, error } = await table
      .select('*')
      .eq('id', requestId)
      .eq('enterprise_id', actor.enterprise_id)
      .single();

    if (error || !data) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Approval request not found: ${requestId}`,
        user_action: 'Verify the request ID and try again.',
        details: { request_id: requestId },
      });
    }

    return data as ApprovalRequest;
  }

  async listRequests(actor: ApprovalActor, filters: ListFilters = {}): Promise<ApprovalRequest[]> {
    let query = (this.supabase.from('policy_approval_requests') as any)
      .select('*')
      .eq('enterprise_id', actor.enterprise_id)
      .order('created_at', { ascending: false });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Failed to list approval requests.',
        user_action: 'Retry the operation.',
      });
    }

    return (data ?? []) as ApprovalRequest[];
  }

  // ─── Fill Slot ─────────────────────────────────────────────────────

  async fillSlot(
    actor: ApprovalActor,
    requestId: string,
    justification: string,
  ): Promise<ApprovalRequest> {
    // 1. Load request, verify enterprise match
    const request = await this.getRequest(actor, requestId);

    // 2. Verify status=pending
    if (request.status !== 'pending') {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_not_pending,
        human_readable: `Cannot approve: request status is '${request.status}', expected 'pending'.`,
        user_action: 'Only pending requests can be approved.',
        details: { request_id: requestId, current_status: request.status },
      });
    }

    // 3. Load rule authors for triggered_rule_ids
    const ruleAuthors = await this.loadRuleAuthors(request.triggered_rule_ids);

    // 4. Call validateSoD
    const sodResult = validateSoD({
      request,
      approverId: actor.user_id,
      approverRole: actor.role,
      ruleAuthors,
    });

    if (!sodResult.ok) {
      throw new ApprovalError({
        reason_code: sodResult.reason_code,
        human_readable: this.sodReasonMessage(sodResult.reason_code),
        user_action: this.sodUserAction(sodResult.reason_code),
        details: { request_id: requestId, approver_id: actor.user_id },
      });
    }

    // 5. Update slot_assignments
    const now = new Date().toISOString();
    const updatedSlots = [...request.slot_assignments];
    updatedSlots[sodResult.slot_index] = {
      ...updatedSlots[sodResult.slot_index],
      filled_by: actor.user_id,
      filled_at: now,
      justification,
    };

    const allFilled = updatedSlots.every((s) => s.filled_by);
    const newStatus = allFilled ? 'approved' : 'pending';
    const approvedAt = allFilled ? now : request.approved_at;

    // 6. Optimistic lock: UPDATE WHERE version = expected
    const expectedVersion = request.version;
    const table = this.supabase.from('policy_approval_requests') as any;

    // Use upsert with id to update (in mock). In production this would be
    // an UPDATE ... WHERE version = N.
    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: updatedSlots,
      status: newStatus,
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      approved_at: approvedAt,
      version: expectedVersion + 1,
    };

    const { data: updated, error } = await table.upsert(updatePayload);
    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Concurrent modification detected. Another user may have acted on this request.',
        user_action: 'Reload the request and try again.',
        details: { request_id: requestId, expected_version: expectedVersion },
      });
    }

    const updatedRow = (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;

    // 7. If all slots filled, call reEvaluate
    if (allFilled) {
      return this.reEvaluate(updatedRow);
    }

    return updatedRow;
  }

  // ─── Re-Evaluate ───────────────────────────────────────────────────

  private async reEvaluate(request: ApprovalRequest): Promise<ApprovalRequest> {
    if (!this.evaluateFn) {
      // No evaluate function injected — mark as executed (stub behavior for Plan 2b)
      return this.resolveRequest(request, 'executed');
    }

    const evalResult = await this.evaluateFn(
      request.proposed_movement,
      request.enterprise_id,
    );

    // Decision matrix
    if (evalResult.verdict === 'allow_auto') {
      // Policy relaxed since request was created — auto-execute
      return this.resolveRequest(request, 'executed');
    }

    if (evalResult.verdict === 'require_approval') {
      // Check if same chain
      if (evalResult.required_chain?.chain_id === request.chain_id) {
        return this.resolveRequest(request, 'executed');
      }
      // Different chain — deny with stale_reeval
      return this.resolveRequest(request, 'denied', 'stale_reeval');
    }

    // block or block_hard_limit
    return this.resolveRequest(request, 'denied', 'stale_reeval');
  }

  private async resolveRequest(
    request: ApprovalRequest,
    status: 'executed' | 'denied',
    denialReason?: 'stale_reeval',
  ): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: request.slot_assignments,
      status,
      denial_reason: denialReason ?? null,
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      approved_at: request.approved_at,
      resolved_at: now,
      version: request.version + 1,
    };

    const { data: updated } = await table.upsert(updatePayload);
    return (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;
  }

  // ─── Deny ──────────────────────────────────────────────────────────

  async deny(
    actor: ApprovalActor,
    requestId: string,
    justification: string,
  ): Promise<ApprovalRequest> {
    const request = await this.getRequest(actor, requestId);

    if (request.status !== 'pending') {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_not_pending,
        human_readable: `Cannot deny: request status is '${request.status}', expected 'pending'.`,
        user_action: 'Only pending requests can be denied.',
        details: { request_id: requestId, current_status: request.status },
      });
    }

    // Verify actor has treasury_manager+ role
    const DENY_ROLE_RANK: Record<string, number> = {
      auditor: 0,
      accountant: 1,
      treasury_manager: 2,
    };

    if ((DENY_ROLE_RANK[actor.role] ?? -1) < DENY_ROLE_RANK['treasury_manager']) {
      throw new ApprovalError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Insufficient role to deny approval requests.',
        user_action: 'Only treasury managers and above can deny requests.',
        details: { required_role: 'treasury_manager', actual_role: actor.role },
      });
    }

    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: request.slot_assignments,
      status: 'denied',
      denial_reason: 'manual',
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      resolved_at: now,
      resolution_notes: { justification, denied_by: actor.user_id },
      version: request.version + 1,
    };

    const { data: updated } = await table.upsert(updatePayload);
    return (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;
  }

  // ─── Cancel ────────────────────────────────────────────────────────

  async cancel(
    actor: ApprovalActor,
    requestId: string,
    reason?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.getRequest(actor, requestId);

    if (request.status !== 'pending') {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_not_pending,
        human_readable: `Cannot cancel: request status is '${request.status}', expected 'pending'.`,
        user_action: 'Only pending requests can be cancelled.',
        details: { request_id: requestId, current_status: request.status },
      });
    }

    // Must be initiator OR enterprise_admin/policy_admin role
    // For now, we check: actor is initiator OR actor is treasury_manager (the highest enterprise role)
    const isInitiator = request.created_by === actor.user_id;
    const isAdmin = actor.role === 'treasury_manager'; // highest enterprise role available

    if (!isInitiator && !isAdmin) {
      throw new ApprovalError({
        reason_code: REASON_CODES.requires_policy_admin,
        human_readable: 'Only the request initiator or an admin can cancel.',
        user_action: 'Contact the request initiator or an enterprise admin.',
        details: { actor_id: actor.user_id, initiator_id: request.created_by },
      });
    }

    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      id: request.id,
      enterprise_id: request.enterprise_id,
      version_id: request.version_id,
      movement_id: request.movement_id,
      proposed_movement: request.proposed_movement,
      triggered_rule_ids: request.triggered_rule_ids,
      chain_id: request.chain_id,
      slot_assignments: request.slot_assignments,
      status: 'cancelled',
      expires_at: request.expires_at,
      created_by: request.created_by,
      created_at: request.created_at,
      resolved_at: now,
      resolution_notes: { reason, cancelled_by: actor.user_id },
      version: request.version + 1,
    };

    const { data: updated } = await table.upsert(updatePayload);
    return (Array.isArray(updated) ? updated[0] : updated) as ApprovalRequest;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async loadRuleAuthors(ruleIds: string[]): Promise<Map<string, string>> {
    if (ruleIds.length === 0) return new Map();

    const table = this.supabase.from('policy_rules') as any;
    const { data } = await table.select('id,created_by').in('id', ruleIds);

    const authors = new Map<string, string>();
    if (data) {
      for (const row of data as Array<{ id: string; created_by: string }>) {
        if (row.created_by) {
          authors.set(row.id, row.created_by);
        }
      }
    }
    return authors;
  }

  private sodReasonMessage(reasonCode: string): string {
    switch (reasonCode) {
      case 'sod_initiator_conflict':
        return 'You cannot approve a request you initiated.';
      case 'sod_rule_editor_conflict':
        return 'You cannot approve a request triggered by a rule you authored.';
      case 'sod_already_filled':
        return 'You have already approved this request.';
      case 'no_matching_slot':
        return 'No approval slot matches your role level.';
      default:
        return 'Approval validation failed.';
    }
  }

  private sodUserAction(reasonCode: string): string {
    switch (reasonCode) {
      case 'sod_initiator_conflict':
        return 'A different team member must approve this request.';
      case 'sod_rule_editor_conflict':
        return 'A team member who did not author the triggering rules must approve.';
      case 'sod_already_filled':
        return 'Wait for another team member to approve the remaining slots.';
      case 'no_matching_slot':
        return 'A user with a higher role level is needed to fill the remaining slots.';
      default:
        return 'Contact your treasury admin.';
    }
  }
}
