// src/app/api/policy/rule-trigger-counts/route.ts
//
// Per-rule fire counts over a time window. Powers the dashboard
// "top firing rules" list + inline trigger badges in the version
// editor. Backed by fn_policy_rule_trigger_counts RPC (migration 0053).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requireRole } from '@/lib/auth/rbac';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(90, parseInt(searchParams.get('days') ?? '30', 10)));
  const versionId = searchParams.get('version_id');

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - days * 86_400_000);

  const supabase = createAdminClient();
  const { data, error } = await (supabase as any).rpc('fn_policy_rule_trigger_counts', {
    p_enterprise_id: enterpriseId,
    p_window_start: windowStart.toISOString(),
    p_window_end: windowEnd.toISOString(),
    p_version_id: versionId || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data: data ?? [],
    meta: { days, window_start: windowStart.toISOString(), window_end: windowEnd.toISOString() },
  });
}
