import { NextRequest, NextResponse } from 'next/server';

/**
 * Scheduled transfer processor — currently a no-op.
 *
 * Scheduled transfers require unattended server-side signing which isn't yet
 * implemented. Until that lands, scheduled transfers are blocked at the API
 * layer (see /api/transfers route) and this cron simply returns without
 * processing anything.
 *
 * When we add server-side signing (HSM/KMS-backed hot wallet), the logic to
 * load pending scheduled transfers and execute them goes here.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    processed: 0,
    note: 'Scheduled transfers are not currently executed. Unattended signing is pending.',
  });
}
