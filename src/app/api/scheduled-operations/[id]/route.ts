import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { isValidUUID } from '@/lib/api/rate-limit';

// ---- GET — fetch single operation (requires treasury_manager) ----

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data: op, error } = await supabase
    .from('scheduled_operations')
    .select('*')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !op) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data: op });
}

// ---- DELETE — cancel operation (requires treasury_manager) ----

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data: op } = await supabase
    .from('scheduled_operations')
    .select('id, status')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (op.status !== 'pending' && op.status !== 'awaiting_authorization') {
    return NextResponse.json(
      { error: 'Only pending or awaiting_authorization operations can be cancelled' },
      { status: 400 },
    );
  }

  await supabase
    .from('scheduled_operations')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  await writeAuditLog({
    userId: session.user.id,
    action: 'scheduled_operation_cancel' as any,
    entityType: 'scheduled_operation',
    entityId: params.id,
    details: { previous_status: op.status },
  });

  return NextResponse.json({ message: 'Operation cancelled' });
}
