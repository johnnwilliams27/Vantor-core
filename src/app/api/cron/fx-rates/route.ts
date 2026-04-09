import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchLiveFxRates } from '@/lib/fx/live-rates';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { rates, fetchedAt } = await fetchLiveFxRates();
    const supabase = createAdminClient();

    for (const [currency, rate] of Object.entries(rates)) {
      await supabase
        .from('fx_rate_cache')
        .upsert(
          {
            base_currency: 'USD',
            target_currency: currency,
            rate,
            fetched_at: fetchedAt,
          },
          { onConflict: 'base_currency,target_currency' },
        );
    }

    return NextResponse.json({ updated: Object.keys(rates).length, rates, fetchedAt });
  } catch (error) {
    console.error('[cron/fx-rates] Failed to fetch live FX rates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch FX rates', detail: String(error) },
      { status: 500 },
    );
  }
}
