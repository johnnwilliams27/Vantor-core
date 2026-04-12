// src/app/api/policy/approvals/[id]/deny/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

const denySchema = z.object({
  justification: z.string().min(1).max(2000),
});

export const POST = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 2];

  const body = await req.json();
  const parsed = denySchema.parse(body);

  const result = await ctx.service.deny(ctx.actor, id, parsed.justification);

  return NextResponse.json({ data: result });
});
