import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { approveAndExecute } from '@/lib/scheduled-operations/executor';
import { isValidUUID } from '@/lib/api/rate-limit';
import type { ScheduledOperation } from '@/types/scheduled-operations';

// ---- POST — approve and execute a flagged operation (requires treasury_manager) ----

export async function POST(
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
    .select('*')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (op.status !== 'awaiting_authorization') {
    return NextResponse.json(
      { error: 'Only operations with status awaiting_authorization can be approved' },
      { status: 400 },
    );
  }

  // Check expiry
  if (op.expires_at && new Date(op.expires_at) < new Date()) {
    await supabase
      .from('scheduled_operations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', params.id);

    return NextResponse.json({ error: 'Operation has expired' }, { status: 410 });
  }

  const result = await approveAndExecute(op as ScheduledOperation);

  if (!result.executed) {
    return NextResponse.json(
      { error: result.error ?? 'Execution failed' },
      { status: 500 },
    );
  }

  // Fetch updated record to return tx_hash
  const { data: updated } = await supabase
    .from('scheduled_operations')
    .select('tx_hash')
    .eq('id', params.id)
    .single();

  return NextResponse.json({ success: true, txHash: updated?.tx_hash ?? null });
}
