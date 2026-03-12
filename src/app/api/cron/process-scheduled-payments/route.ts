import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { executePayment } from '@/lib/payments/executor';
import type { Payment } from '@/types/database';

const BATCH_SIZE = 50;

// Cross-enterprise system job: processes scheduled payments across all enterprises.
// No session available — authenticated via CRON_SECRET. Each payment record already
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

  // Find due scheduled payments (excluding test enterprises)
  let query = supabase
    .from('payments')
    .select('*')
    .eq('status', 'pending')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', new Date().toISOString())
    .limit(BATCH_SIZE);

  if (testEntIds.length > 0) {
    query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: payments, error } = await query;

  if (error) {
    console.error('[cron/payments]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!payments?.length) {
    return NextResponse.json({ processed: 0 });
  }

  let succeeded = 0;
  let failed = 0;

  for (const payment of payments as Payment[]) {
    const result = await executePayment(payment);
    if (result.txHash) succeeded++;
    else failed++;
  }

  console.log(`[cron/payments] processed=${payments.length} ok=${succeeded} fail=${failed}`);
  return NextResponse.json({ processed: payments.length, succeeded, failed });
}
