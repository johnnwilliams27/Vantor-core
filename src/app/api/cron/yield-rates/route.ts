import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { DECLARED_RATE_KEYS, fetchAllRates } from '@/lib/yield/rates';
import { sweepUndeclaredRateRows } from './sweep';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { rates, failures } = await fetchAllRates();

  // Upsert successful rates
  for (const rate of rates) {
    await supabase
      .from('yield_rate_cache')
      .upsert(
        {
          protocol: rate.protocol,
          token: rate.token,
          chain: rate.chain,
          supply_apy: rate.supplyAPY,
          reward_apy: rate.rewardAPY,
          total_apy: rate.supplyAPY + rate.rewardAPY,
          tvl_usd: rate.tvlUsd ?? null,
          fetched_at: new Date().toISOString(),
          is_stale: false,
        },
        { onConflict: 'protocol,token,chain' },
      );
  }

  // Mark failed protocols as stale (keep last known rate)
  for (const failure of failures) {
    console.error(`[cron/yield-rates] ${failure.name} failed: ${failure.error}`);
    await supabase
      .from('yield_rate_cache')
      .update({ is_stale: true })
      .eq('protocol', failure.name);
  }

  // Evict rows whose key is no longer declared by any fetcher.
  const { swept } = await sweepUndeclaredRateRows(supabase, DECLARED_RATE_KEYS);

  return NextResponse.json({
    updated: rates.length,
    failed: failures.length,
    failures: failures.map((f) => f.name),
    swept,
  });
}
