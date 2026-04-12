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

// ─── Constants ────────────────────────────────────────────────────────

/** Max justification length at the service layer (route layer also enforces). */
export const MAX_JUSTIFICATION_LEN = 2000;

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
    // Invariant: chain must have at least one slot. An empty slot array would
    // make `every(s => s.filled_by)` return true for zero fills -- vacuous
    // approval. Fail closed at creation.
    if (!input.chain.slots || input.chain.slots.length === 0) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Approval chain has zero slots; cannot create request.',
        user_action: 'Contact an enterprise admin to fix the approval chain.',
        details: { chain_id: input.chain.chain_id, movement_id: input.movement_id },
      });
    }

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
    // Defense-in-depth: cap justification at the service layer even though
    // the API route layer also caps at 2000 chars (see routes/approve).
    const trimmedJustification = (justification ?? '').toString();
    if (trimmedJustification.length === 0 || trimmedJustification.length > MAX_JUSTIFICATION_LEN) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Justification must be between 1 and ${MAX_JUSTIFICATION_LEN} characters.`,
        user_action: 'Provide a shorter justification.',
        details: { request_id: requestId, length: trimmedJustification.length },
      });
    }

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

    // Invariant: pending requests must have slot assignments. Reject vacuous
    // approvals (empty array would make `every(...)` vacuously true below).
    if (!request.slot_assignments || request.slot_assignments.length === 0) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Approval request has no slots; cannot be approved.',
        user_action: 'Contact an enterprise admin.',
        details: { request_id: requestId },
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

    // 5. Compute updated slot array + validate the chosen slot is still free
    const now = new Date().toISOString();
    const updatedSlots = [...request.slot_assignments];
    const targetSlot = updatedSlots[sodResult.slot_index];
    if (!targetSlot || targetSlot.filled_by) {
      // Defensive: validateSoD returned an index, but between the SoD check
      // and here the slot should not become filled. If it has, treat as
      // concurrent modification.
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Slot was filled by another approver during validation.',
        user_action: 'Reload and try again.',
        details: { request_id: requestId, slot_index: sodResult.slot_index },
      });
    }
    updatedSlots[sodResult.slot_index] = {
      ...targetSlot,
      filled_by: actor.user_id,
      filled_at: now,
      justification: trimmedJustification,
    };

    const allFilled = updatedSlots.length > 0 && updatedSlots.every((s) => s.filled_by);
    const newStatus = allFilled ? 'approved' : 'pending';
    const approvedAt = allFilled ? now : request.approved_at;

    // 6. Optimistic lock: UPDATE WHERE id=? AND enterprise_id=? AND version=expected
    // If zero rows match, another approver modified first -> concurrent_modification.
    const expectedVersion = request.version;
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      slot_assignments: updatedSlots,
      status: newStatus,
      approved_at: approvedAt,
      version: expectedVersion + 1,
    };

    const updateBuilder = table
      .update(updatePayload)
      .eq('id', request.id)
      .eq('enterprise_id', actor.enterprise_id)
      .eq('version', expectedVersion);

    const { data: updated, error } = await (
      typeof updateBuilder.select === 'function' ? updateBuilder.select() : updateBuilder
    );

    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Database error while recording approval.',
        user_action: 'Retry the operation.',
        details: { request_id: requestId },
        cause: error,
      });
    }

    const updatedRows = (Array.isArray(updated) ? updated : updated ? [updated] : []) as ApprovalRequest[];
    if (updatedRows.length === 0) {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Concurrent modification detected. Another user may have acted on this request.',
        user_action: 'Reload the request and try again.',
        details: { request_id: requestId, expected_version: expectedVersion },
      });
    }

    const updatedRow = updatedRows[0];

    // 7. If all slots filled, call reEvaluate
    if (allFilled) {
      return this.reEvaluate(updatedRow);
    }

    return updatedRow;
  }

  // ─── Re-Evaluate ───────────────────────────────────────────────────

  private async reEvaluate(request: ApprovalRequest): Promise<ApprovalRequest> {
    if (!this.evaluateFn) {
      // Plan 2b stub path: no evaluate fn injected. This is INTENDED for unit
      // tests and the integration smoke test only. Production callers (the
      // HTTP handler wired via Plan 3+) MUST inject an evaluate function —
      // the API gateway should assert this at boot. Here we mark 'executed'
      // with an audit note so forensic analysis can tell stub-executions
      // from real-engine-executions.
      return this.resolveRequest(request, 'executed', undefined, {
        reeval_mode: 'stub_no_engine',
      });
    }

    // Wrap evaluate in try/catch: if the engine throws (network blip, policy
    // engine down), fail CLOSED -- deny the request with a dedicated reason
    // rather than leaving the row stuck in 'approved' status forever.
    let evalResult;
    try {
      evalResult = await this.evaluateFn(
        request.proposed_movement,
        request.enterprise_id,
      );
    } catch (err) {
      return this.resolveRequest(request, 'denied', 'stale_reeval', {
        reeval_mode: 'engine_threw',
        error_message: err instanceof Error ? err.message : String(err),
      });
    }

    // Decision matrix (with audit trail in resolution_notes)
    if (evalResult.verdict === 'allow_auto') {
      // Policy was relaxed since request was created. The humans pre-approved,
      // and the movement no longer requires approvals -- execute.
      return this.resolveRequest(request, 'executed', undefined, {
        reeval_mode: 'engine',
        reeval_verdict: 'allow_auto',
        original_chain_id: request.chain_id,
      });
    }

    if (evalResult.verdict === 'require_approval') {
      // Defense-in-depth: compare BOTH chain_id and version_id when available.
      // A policy admin editing a chain in place would keep chain_id stable
      // but bump version_id. We treat that as "policy changed" -> stale.
      const sameChain = evalResult.required_chain?.chain_id === request.chain_id;
      const sameVersion =
        !('version_id' in (evalResult.required_chain ?? {})) ||
        (evalResult.required_chain as { version_id?: string } | undefined)?.version_id ===
          request.version_id;

      if (sameChain && sameVersion) {
        return this.resolveRequest(request, 'executed', undefined, {
          reeval_mode: 'engine',
          reeval_verdict: 'require_approval',
          chain_id: request.chain_id,
        });
      }

      // Different chain or different version -- deny with stale_reeval
      return this.resolveRequest(request, 'denied', 'stale_reeval', {
        reeval_mode: 'engine',
        reeval_verdict: 'require_approval',
        original_chain_id: request.chain_id,
        new_chain_id: evalResult.required_chain?.chain_id,
      });
    }

    // block or block_hard_limit
    return this.resolveRequest(request, 'denied', 'stale_reeval', {
      reeval_mode: 'engine',
      reeval_verdict: evalResult.verdict,
      reason_codes: evalResult.reason_codes ?? [],
    });
  }

  private async resolveRequest(
    request: ApprovalRequest,
    status: 'executed' | 'denied',
    denialReason?: 'stale_reeval',
    resolutionNotes?: Record<string, unknown>,
  ): Promise<ApprovalRequest> {
    const now = new Date().toISOString();
    const table = this.supabase.from('policy_approval_requests') as any;

    const updatePayload: Record<string, unknown> = {
      status,
      denial_reason: denialReason ?? null,
      resolved_at: now,
      version: request.version + 1,
      ...(resolutionNotes ? { resolution_notes: resolutionNotes } : {}),
    };

    const updateBuilder = table
      .update(updatePayload)
      .eq('id', request.id)
      .eq('enterprise_id', request.enterprise_id)
      .eq('version', request.version);

    const { data: updated, error } = await (
      typeof updateBuilder.select === 'function' ? updateBuilder.select() : updateBuilder
    );

    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Database error while resolving approval request.',
        user_action: 'Retry the operation or contact support.',
        details: { request_id: request.id, target_status: status },
        cause: error,
      });
    }

    const rows = (Array.isArray(updated) ? updated : updated ? [updated] : []) as ApprovalRequest[];
    if (rows.length === 0) {
      // Zero rows matched the version predicate. Do NOT fabricate a success
      // response -- that would gaslight the caller. Raise a concrete error.
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Request was modified concurrently while being resolved.',
        user_action: 'Reload and inspect the request state.',
        details: { request_id: request.id, expected_version: request.version },
      });
    }
    return rows[0];
  }

  // ─── Deny ──────────────────────────────────────────────────────────

  async deny(
    actor: ApprovalActor,
    requestId: string,
    justification: string,
  ): Promise<ApprovalRequest> {
    // Defense-in-depth justification cap (same as fillSlot).
    const trimmedJustification = (justification ?? '').toString();
    if (trimmedJustification.length === 0 || trimmedJustification.length > MAX_JUSTIFICATION_LEN) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: `Justification must be between 1 and ${MAX_JUSTIFICATION_LEN} characters.`,
        user_action: 'Provide a shorter justification.',
        details: { request_id: requestId, length: trimmedJustification.length },
      });
    }

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
      status: 'denied',
      denial_reason: 'manual',
      resolved_at: now,
      resolution_notes: { justification: trimmedJustification, denied_by: actor.user_id },
      version: request.version + 1,
    };

    const updateBuilder = table
      .update(updatePayload)
      .eq('id', request.id)
      .eq('enterprise_id', actor.enterprise_id)
      .eq('version', request.version);

    const { data: updated, error } = await (
      typeof updateBuilder.select === 'function' ? updateBuilder.select() : updateBuilder
    );

    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Database error while denying request.',
        user_action: 'Retry the operation.',
        details: { request_id: requestId },
        cause: error,
      });
    }

    const rows = (Array.isArray(updated) ? updated : updated ? [updated] : []) as ApprovalRequest[];
    if (rows.length === 0) {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Concurrent modification detected while denying request.',
        user_action: 'Reload and try again.',
        details: { request_id: requestId },
      });
    }
    return rows[0];
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

    const cappedReason =
      typeof reason === 'string' && reason.length > MAX_JUSTIFICATION_LEN
        ? reason.slice(0, MAX_JUSTIFICATION_LEN)
        : reason;

    const updatePayload: Record<string, unknown> = {
      status: 'cancelled',
      resolved_at: now,
      resolution_notes: { reason: cappedReason, cancelled_by: actor.user_id },
      version: request.version + 1,
    };

    const updateBuilder = table
      .update(updatePayload)
      .eq('id', request.id)
      .eq('enterprise_id', actor.enterprise_id)
      .eq('version', request.version);

    const { data: updated, error } = await (
      typeof updateBuilder.select === 'function' ? updateBuilder.select() : updateBuilder
    );

    if (error) {
      throw new ApprovalError({
        reason_code: REASON_CODES.gate_internal_error,
        human_readable: 'Database error while cancelling request.',
        user_action: 'Retry the operation.',
        details: { request_id: requestId },
        cause: error,
      });
    }

    const rows = (Array.isArray(updated) ? updated : updated ? [updated] : []) as ApprovalRequest[];
    if (rows.length === 0) {
      throw new ApprovalError({
        reason_code: REASON_CODES.approval_concurrent_modification,
        human_readable: 'Concurrent modification detected while cancelling request.',
        user_action: 'Reload and try again.',
        details: { request_id: requestId },
      });
    }
    return rows[0];
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
