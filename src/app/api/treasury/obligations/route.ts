import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();
  // Table was renamed manual_obligations → obligations in migration 0041
  // (formerly numbered 0036 pre-merge). Legacy columns
  // (amount_usd, is_recurring, recurrence_days, is_active)
  // are kept on the renamed table as deprecated NOT NULL mirrors, so this
  // legacy route's shape contract keeps working without a UI cutover.
  const { data, error } = await supabase
    .from('obligations')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .order('due_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

const createSchema = z.object({
  label: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  amount_usd: z.coerce.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  is_recurring: z.coerce.boolean().default(false),
  recurrence_days: z.coerce.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Same rename as the GET above. Also writes `amount` alongside
  // the legacy `amount_usd` mirror — migration 0041 made `amount`
  // NOT NULL (and has no default), so inserts that only set
  // amount_usd will 400 against the renamed table.
  const { data: obligation, error } = await supabase
    .from('obligations')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      label: parsed.data.label,
      description: parsed.data.description ?? null,
      amount: parsed.data.amount_usd,
      amount_usd: parsed.data.amount_usd,
      due_date: parsed.data.due_date,
      is_recurring: parsed.data.is_recurring,
      recurrence_days: parsed.data.recurrence_days ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_obligation_create',
    entityType: 'manual_obligation',
    entityId: obligation.id,
    details: { label: parsed.data.label, amount_usd: parsed.data.amount_usd },
  });

  return NextResponse.json({ data: obligation }, { status: 201 });
}
