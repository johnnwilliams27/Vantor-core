import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { executeScheduledOperation } from '@/lib/scheduled-operations/executor';
import { writeAuditLog } from '@/lib/audit/logger';
import type { ScheduledOperation } from '@/types/scheduled-operations';

const BATCH_SIZE = 50;

// Cross-enterprise system job: processes due scheduled operations across all enterprises.
// No session available — authenticated via CRON_SECRET. Each operation record already
// contains its own user_id/enterprise_id context, so no cross-enterprise data leakage occurs.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get test enterprise IDs to exclude from cron processing
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e) => e.id);

  // Find due pending operations (excluding test enterprises)
  let pendingQuery = supabase
    .from('scheduled_operations')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(BATCH_SIZE);

  if (testEntIds.length > 0) {
    pendingQuery = pendingQuery.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: pendingOps, error: pendingError } = await pendingQuery;

  if (pendingError) {
    console.error('[cron/scheduled-operations] pending query error:', pendingError);
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  let executed = 0;
  let flagged = 0;
  let failed = 0;

  for (const op of (pendingOps ?? []) as ScheduledOperation[]) {
    const result = await executeScheduledOperation(op);
    if (result.executed) executed++;
    else if (result.flagged) flagged++;
    else failed++;
    // TODO: Slack notifications added in Task 6
  }

  // Expire awaiting_authorization operations whose window has passed
  let expiryQuery = supabase
    .from('scheduled_operations')
    .select('*')
    .eq('status', 'awaiting_authorization')
    .lte('expires_at', new Date().toISOString());

  if (testEntIds.length > 0) {
    expiryQuery = expiryQuery.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: expiredOps, error: expiryError } = await expiryQuery;

  if (expiryError) {
    console.error('[cron/scheduled-operations] expiry query error:', expiryError);
  }

  let expired = 0;

  for (const op of (expiredOps ?? []) as ScheduledOperation[]) {
    const { error: updateError } = await supabase
      .from('scheduled_operations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', op.id);

    if (updateError) {
      console.error(`[cron/scheduled-operations] failed to expire op ${op.id}:`, updateError);
      continue;
    }

    await writeAuditLog({
      userId: op.user_id,
      enterpriseId: op.enterprise_id,
      action: 'scheduled_operation_expire' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: {
        type: op.type,
        scheduled_for: op.scheduled_for,
        expires_at: op.expires_at,
      },
    });

    expired++;
    // TODO: Slack notifications added in Task 6
  }

  console.log(
    `[cron/scheduled-operations] executed=${executed} flagged=${flagged} failed=${failed} expired=${expired}`,
  );

  return NextResponse.json({ executed, flagged, failed, expired });
}
