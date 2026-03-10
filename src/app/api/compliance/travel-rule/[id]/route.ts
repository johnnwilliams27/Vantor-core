import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

const updateSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('travel_rule_transfers')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const { id } = await params;
  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('travel_rule_transfers')
    .select('id')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const now = new Date().toISOString();
  const { data: transfer, error } = await supabase
    .from('travel_rule_transfers')
    .update({
      status: parsed.data.status,
      received_at: parsed.data.status === 'accepted' ? now : undefined,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'compliance_travel_rule_update',
    entityType: 'travel_rule_transfer',
    entityId: id,
    details: { status: parsed.data.status },
  });

  return NextResponse.json({ data: transfer });
}
