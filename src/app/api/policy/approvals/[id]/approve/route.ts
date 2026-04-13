// src/app/api/policy/approvals/[id]/approve/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';
import { dispatchExecute, dispatchDeny } from '@/lib/policy/executor';

const approveSchema = z.object({
  justification: z.string().min(1).max(2000),
});

export const POST = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/policy/approvals/[id]/approve  =>  id is segments[segments.length - 2]
  const id = segments[segments.length - 2];

  const body = await req.json();
  const parsed = approveSchema.parse(body);

  const result = await ctx.service.fillSlot(ctx.actor, id, parsed.justification);

  // If this approval filled the last slot, the service already re-evaluated
  // and set status to 'executed' or 'denied'. Dispatch to the executor
  // registry to run (or roll back) the held domain-row work. The approval
  // row itself has already been updated by the service — executor outcome
  // lands on the domain row, not the approval row.
  if (result.status === 'executed') {
    try {
      const execution = await dispatchExecute(
        result.proposed_movement,
        result,
        ctx.supabase,
      );
      return NextResponse.json({ data: result, execution });
    } catch (err) {
      // Executor threw (as opposed to returning {status:'failed'}). Record
      // and surface — the approval remains 'executed' since the approvers
      // did approve; execution failure is a separate concern for ops.
      return NextResponse.json(
        {
          data: result,
          execution: {
            status: 'failed',
            error: (err as Error).message,
            notes: { threw: true },
          },
        },
        { status: 200 },
      );
    }
  }

  if (result.status === 'denied') {
    // reEvaluate determined the movement is now stale/blocked. Flip the
    // domain row to denied too so ops sees the rollback.
    try {
      await dispatchDeny(
        result.proposed_movement,
        result,
        result.denial_reason ?? 'stale_reeval',
        ctx.supabase,
      );
    } catch (err) {
      // Non-fatal — approval is still denied. Log only.
      console.error('[approve POST] dispatchDeny failed after stale reeval', {
        request_id: result.id,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json({ data: result });
});
