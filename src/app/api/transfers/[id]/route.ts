import { isValidUUID } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const supabase = createAdminClient();

  // Only pending transfers can be cancelled
  const { data: transfer } = await supabase
    .from('transfers')
    .select('id, status')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!transfer) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
  if (transfer.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending transfers can be cancelled' }, { status: 400 });
  }

  await supabase
    .from('transfers')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  await writeAuditLog({
    userId: session.user.id,
    action: 'transfer_cancel',
    entityType: 'transfer',
    entityId: params.id,
  });

  return NextResponse.json({ message: 'Transfer cancelled' });
}
