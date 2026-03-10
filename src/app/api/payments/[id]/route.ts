import { isValidUUID } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';

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

  // Only pending payments can be cancelled
  const { data: payment } = await supabase
    .from('payments')
    .select('id, status')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  if (payment.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending payments can be cancelled' }, { status: 400 });
  }

  await supabase
    .from('payments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  await writeAuditLog({
    userId: session.user.id,
    action: 'payment_cancel',
    entityType: 'payment',
    entityId: params.id,
  });

  return NextResponse.json({ message: 'Payment cancelled' });
}
