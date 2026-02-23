import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

const updateSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  safety_buffer_multiplier: z.number().min(1).max(10).optional(),
  obligation_lookahead_days: z.number().int().min(1).max(365).optional(),
  target_stablecoin: z.string().optional(),
  target_chain: z.string().optional(),
  approval_threshold_usd: z.number().positive().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: rule, error } = await supabase
    .from('treasury_rules')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rule) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_rule_update',
    entityType: 'treasury_rule',
    entityId: params.id,
    details: parsed.data as Record<string, unknown>,
  });

  return NextResponse.json({ data: rule });
}
