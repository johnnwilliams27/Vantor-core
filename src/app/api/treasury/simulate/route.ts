import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { runHistoricalSimulation } from '@/lib/treasury/simulation';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const schema = z.object({
  rule_overrides: z
    .object({
      safety_buffer_multiplier: z.number().min(1).max(10).optional(),
      obligation_lookahead_days: z.number().int().min(1).max(365).optional(),
      approval_threshold_usd: z.number().positive().optional(),
      label: z.string().min(1).max(200).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 10_000) {
      return NextResponse.json({ error: 'Request body too large' }, { status: 400 });
    }
    if (text) body = JSON.parse(text);
  } catch {
    // empty body is fine
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const userId = session.user.id;

  try {
    const run = await runHistoricalSimulation(supabase, userId, parsed.data.rule_overrides, enterpriseId);

    await writeAuditLog({
      userId,
      action: 'treasury_simulation_run',
      entityType: 'simulation_run',
      entityId: run.id,
      details: {
        rule_snapshot: run.rule_snapshot,
        total_recommendations: run.summary.total_recommendations,
      },
    });

    return NextResponse.json({ data: run }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
