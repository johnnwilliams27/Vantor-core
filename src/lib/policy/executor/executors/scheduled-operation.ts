// src/lib/policy/executor/executors/scheduled-operation.ts
//
// Scheduled operations are executed by the cron worker at their
// scheduled_for time, not synchronously. On approval, flipping
// status from 'awaiting_approval' → 'pending' is all that's needed —
// the cron will then pick the row up on its normal cycle. On denial,
// status goes to 'denied'.

import type { Executor, ExecuteResult, SupabaseLike, ExecutorDenyReason } from '../types';
import type { ProposedMovement } from '../../types/movement';
import type { ApprovalRequest } from '../../approvals/types';

const TERMINAL_STATUSES = new Set([
  'completed', 'failed', 'denied', 'cancelled', 'expired',
]);

async function loadOp(supabase: SupabaseLike, movementId: string, enterpriseId: string) {
  const { data, error } = await (supabase.from('scheduled_operations') as any)
    .select('*')
    .eq('id', movementId)
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();
  if (error) throw new Error(`loadOp: ${error.message}`);
  return data;
}

export const scheduledOperationExecutor: Executor = {
  async execute(
    movement: ProposedMovement,
    request: ApprovalRequest,
    { supabase },
  ): Promise<ExecuteResult> {
    const op = await loadOp(supabase, movement.id, request.enterprise_id);
    if (!op) {
      return {
        status: 'failed',
        error: 'scheduled_operations row not found for this approval.',
        notes: { movement_id: movement.id },
      };
    }
    if (TERMINAL_STATUSES.has(op.status)) {
      return {
        status: op.status === 'completed' ? 'completed' : 'failed',
        notes: { idempotent: true, prior_status: op.status },
      };
    }

    // Flip to 'pending' so the cron scheduled-ops executor picks it up
    // on the next tick at or after scheduled_for. Defense-in-depth
    // enterprise_id on UPDATE.
    await (supabase.from('scheduled_operations') as any)
      .update({ status: 'pending' })
      .eq('id', op.id)
      .eq('enterprise_id', request.enterprise_id);

    return {
      status: 'pending',
      notes: {
        scheduled_for: op.scheduled_for,
        type: op.type,
        executed_via_approval: true,
        next_step: 'cron_will_pick_up_at_scheduled_for',
      },
    };
  },

  async deny(
    movement: ProposedMovement,
    request: ApprovalRequest,
    denialReason: ExecutorDenyReason,
    { supabase },
  ): Promise<void> {
    const op = await loadOp(supabase, movement.id, request.enterprise_id);
    if (!op) return;
    if (TERMINAL_STATUSES.has(op.status)) return;
    await (supabase.from('scheduled_operations') as any)
      .update({ status: 'denied', denial_reason: denialReason })
      .eq('id', op.id)
      .eq('enterprise_id', request.enterprise_id);
  },
};
