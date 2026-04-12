import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMockFxRates } from '@/lib/fx/rates';

// Opt out of static generation: this handler reads SUPABASE_SERVICE_ROLE_KEY
// via createAdminClient(), which is not available during the preview build
// environment. Forcing dynamic means Next.js evaluates the handler per
// request, not at build time.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createAdminClient();

  const { data: cached } = await supabase
    .from('fx_rate_cache')
    .select('target_currency, rate, fetched_at')
    .eq('base_currency', 'USD');

  // If we have cached rates, return them
  if (cached && cached.length > 0) {
    const rates: Record<string, number> = { USD: 1 };
    let fetchedAt = '';
    for (const row of cached) {
      rates[row.target_currency] = parseFloat(row.rate);
      if (!fetchedAt || row.fetched_at > fetchedAt) {
        fetchedAt = row.fetched_at;
      }
    }
    return NextResponse.json({ rates, fetchedAt, source: 'exchangeratesapi.io' });
  }

  // Fallback to mock rates
  return NextResponse.json({
    rates: getMockFxRates(),
    fetchedAt: null,
    source: 'mock',
  });
}
