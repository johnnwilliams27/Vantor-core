// src/app/api/policy/approvals/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';
import { dispatchDeny } from '@/lib/policy/executor';

const cancelSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const POST = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 2];

  const body = await req.json();
  const parsed = cancelSchema.parse(body);

  const result = await ctx.service.cancel(ctx.actor, id, parsed.reason);

  // Flip the held domain row to denied with reason='cancelled' so ops
  // never sees a stuck 'awaiting_approval' row from a cancelled request.
  try {
    await dispatchDeny(
      result.proposed_movement,
      result,
      'cancelled',
      ctx.supabase,
    );
  } catch (err) {
    console.error('[cancel POST] dispatchDeny failed', {
      request_id: result.id,
      error: (err as Error).message,
    });
  }

  return NextResponse.json({ data: result });
});
