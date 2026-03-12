import { isValidUUID } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

const rejectSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: rec, error: fetchErr } = await supabase
    .from('ai_recommendations')
    .select('id, status, action, recommended_amount_usd')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!rec) return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
  if (rec.status !== 'pending_approval') {
    return NextResponse.json({ error: `Cannot reject recommendation with status: ${rec.status}` }, { status: 422 });
  }

  const { error: updateErr } = await supabase
    .from('ai_recommendations')
    .update({
      status: 'rejected',
      rejected_by: session.user.id,
      rejected_at: new Date().toISOString(),
      rejection_reason: parsed.data.reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_recommendation_reject',
    entityType: 'ai_recommendation',
    entityId: params.id,
    details: {
      reason: parsed.data.reason,
      action: rec.action,
      amount_usd: rec.recommended_amount_usd,
    },
  });

  return NextResponse.json({ data: { status: 'rejected' } });
}
