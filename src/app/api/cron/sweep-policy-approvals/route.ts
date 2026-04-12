// src/app/api/cron/sweep-policy-approvals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sweepExpiredApprovals } from '@/lib/policy/approvals/sweeper';

// Cross-enterprise system job: sweeps expired approval requests.
// No session available — authenticated via CRON_SECRET.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  try {
    const result = await sweepExpiredApprovals(supabase);

    console.log(`[cron/sweep-policy-approvals] expired_count=${result.expired_count}`);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/sweep-policy-approvals]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
