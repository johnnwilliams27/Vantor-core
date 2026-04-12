// src/app/api/policy/approvals/[id]/route.ts

import { NextResponse } from 'next/server';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';

export const GET = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const id = url.pathname.split('/').pop()!;

  const result = await ctx.service.getRequest(ctx.actor, id);

  return NextResponse.json({ data: result });
});
