import { isValidUUID } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

const updateSchema = z.object({
  status: z.enum(['unpaid', 'paid', 'partially_paid', 'overdue', 'cancelled']).optional(),
  linkedTxId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createAdminClient();
  const updateData: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.linkedTxId !== undefined) updateData.linked_tx_id = parsed.data.linkedTxId;
  if (parsed.data.dueDate !== undefined) updateData.due_date = parsed.data.dueDate;

  const { data, error } = await supabase
    .from('invoices')
    .update(updateData)
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'invoice_update',
    entityType: 'invoice',
    entityId: params.id,
    details: updateData,
  });

  return NextResponse.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: 'Invoice deleted' });
}
