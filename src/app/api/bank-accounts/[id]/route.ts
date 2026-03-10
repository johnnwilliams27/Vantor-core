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
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const supabase = createAdminClient();

  // Verify ownership before deactivating
  const { data: account } = await supabase
    .from('bank_accounts')
    .select('id, institution_name')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .single();

  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Soft-delete: mark inactive
  const { error } = await supabase
    .from('bank_accounts')
    .update({ is_active: false })
    .eq('id', params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'bank_account_disconnect',
    entityType: 'bank_account',
    entityId: params.id,
    details: { institution: account.institution_name },
  });

  return NextResponse.json({ success: true });
}
