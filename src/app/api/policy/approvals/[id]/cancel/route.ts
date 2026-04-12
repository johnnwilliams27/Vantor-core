// src/app/api/policy/approvals/[id]/cancel/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

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

  return NextResponse.json({ data: result });
});
