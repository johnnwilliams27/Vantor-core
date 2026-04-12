// src/app/api/policy/approvals/route.ts

import { NextResponse } from 'next/server';
import { handleApprovalRequest } from '@/lib/policy/approvals/http';
import type { ApprovalStatus } from '@/lib/policy/approvals/types';

export const GET = handleApprovalRequest(async (req, ctx) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') as ApprovalStatus | null;
  const limit = url.searchParams.get('limit');
  const cursor = url.searchParams.get('cursor');

  const results = await ctx.service.listRequests(ctx.actor, {
    status: status ?? undefined,
    limit: limit ? parseInt(limit, 10) : undefined,
    cursor: cursor ?? undefined,
  });

  return NextResponse.json({ data: results });
});
