import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { executeTransfer } from '@/lib/transfers/executor';
import type { Transfer } from '@/types/database';

const BATCH_SIZE = 50;

// Cross-enterprise system job: processes scheduled transfers across all enterprises.
// No session available — authenticated via CRON_SECRET. Each transfer record already
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

  // Find due scheduled transfers (excluding test enterprises)
  let query = supabase
    .from('transfers')
    .select('*')
    .eq('status', 'pending')
    .not('scheduled_for', 'is', null)
    .lte('scheduled_for', new Date().toISOString())
    .limit(BATCH_SIZE);

  if (testEntIds.length > 0) {
    query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: transfers, error } = await query;

  if (error) {
    console.error('[cron/transfers]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!transfers?.length) {
    return NextResponse.json({ processed: 0 });
  }

  let succeeded = 0;
  let failed = 0;

  for (const transfer of transfers as Transfer[]) {
    const result = await executeTransfer(transfer);
    if (result.txHash) succeeded++;
    else failed++;
  }

  console.log(`[cron/transfers] processed=${transfers.length} ok=${succeeded} fail=${failed}`);
  return NextResponse.json({ processed: transfers.length, succeeded, failed });
}
