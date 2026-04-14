// src/app/api/policy/evaluations/route.ts
//
// List persisted policy_evaluations for the History browser. Filterable
// by verdict, date range, rule id. Returns a compact projection of each
// row so the list renders fast; full trace lives in the row and is
// revealed in a drawer on demand.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requireRole } from '@/lib/auth/rbac';

const VALID_VERDICTS = new Set(['allow_auto', 'require_approval', 'block', 'block_hard_limit']);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'auditor'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const verdict = searchParams.get('verdict');
  const ruleId = searchParams.get('rule_id');
  const sinceDays = Math.max(1, Math.min(365, parseInt(searchParams.get('since_days') ?? '30', 10)));
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') ?? '100', 10)));

  const supabase = createAdminClient();
  let q = supabase
    .from('policy_evaluations')
    .select('id, enterprise_id, version_id, movement_id, proposed_movement, verdict, reason_codes, executed_at, execution_ref, created_at, trace, canonicalization')
    .eq('enterprise_id', enterpriseId)
    .gte('created_at', new Date(Date.now() - sinceDays * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (verdict && VALID_VERDICTS.has(verdict)) q = q.eq('verdict', verdict);

  let { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Post-filter by rule_id (JSONB — simpler to filter in app for PR 1;
  // if volume demands, push into an rpc later).
  if (ruleId) {
    data = (data ?? []).filter((row: any) => {
      const rules = row?.trace?.rules_evaluated as Array<{ rule_id: string; matched: boolean }> | undefined;
      return Array.isArray(rules) && rules.some((r) => r.rule_id === ruleId && r.matched);
    });
  }

  return NextResponse.json({ data: data ?? [] });
}
