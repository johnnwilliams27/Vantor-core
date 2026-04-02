import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('fiat_payments')
    .select('*, from_bank_account:bank_accounts(id, institution_name, account_name, last4, nickname)')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  return NextResponse.json({ data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  // Fetch the payment first to validate cancellability
  const { data: payment, error: fetchErr } = await supabase
    .from('fiat_payments')
    .select('id, scheduled_for, executed_at, status')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (fetchErr || !payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });

  // Only scheduled payments that haven't been executed can be cancelled
  if (!payment.scheduled_for || payment.executed_at !== null) {
    return NextResponse.json({ error: 'In-flight payments cannot be cancelled' }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('fiat_payments')
    .update({ status: 'cancelled' })
    .eq('id', params.id)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'fiat_payment_cancel',
    entityType: 'fiat_payment',
    entityId: params.id,
    details: { previousStatus: payment.status },
  });

  return NextResponse.json({ data: updated });
}
