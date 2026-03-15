import { NextRequest, NextResponse } from 'next/server';
import { submitToIndexNow, PUBLIC_URLS } from '@/lib/indexnow';

/**
 * GET /api/indexnow — Submit all public pages to IndexNow.
 * Protected by CRON_SECRET so only your cron job or manual call can trigger it.
 *
 * Usage:
 *   curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://vantor.xyz/api/indexnow
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;

  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await submitToIndexNow(PUBLIC_URLS);
    return NextResponse.json({
      submitted: PUBLIC_URLS,
      ...result,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
