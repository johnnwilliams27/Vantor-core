// src/app/api/policy/approvals/[id]/approve/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

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

  return NextResponse.json({ data: result });
});
