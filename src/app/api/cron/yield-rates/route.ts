import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { DECLARED_RATE_KEYS, fetchAllRates, type RateKey } from '@/lib/yield/rates';

/**
 * Delete any row whose (protocol, token, chain) is not in `declared`. Runs
 * after upserts + stale-marks so that retiring a venue or a fetcher no longer
 * emitting a tuple (e.g. the 2026-04-19 `kamino_multiply` removal) causes the
 * row to self-evict on the next tick, instead of zombie-ing forever.
 *
 * Guarded against an empty `declared` list: if we lost the fetcher aggregator
 * somehow, we must not wipe the whole cache.
 */
export async function sweepUndeclaredRateRows(
  supabase: SupabaseClient,
  declared: ReadonlyArray<RateKey>,
): Promise<{ swept: number; skipped: boolean }> {
  if (declared.length === 0) {
    return { swept: 0, skipped: true };
  }

  const { data: existing, error } = await supabase
    .from('yield_rate_cache')
    .select('protocol, token, chain');
  if (error || !existing) {
    console.error('[cron/yield-rates] sweep read failed:', error);
    return { swept: 0, skipped: true };
  }

  const declaredSet = new Set(
    declared.map((k) => `${k.protocol}|${k.token}|${k.chain}`),
  );
  const orphans = existing.filter(
    (row) => !declaredSet.has(`${row.protocol}|${row.token}|${row.chain}`),
  );

  let swept = 0;
  for (const row of orphans) {
    const { error: delErr } = await supabase
      .from('yield_rate_cache')
      .delete()
      .eq('protocol', row.protocol)
      .eq('token', row.token)
      .eq('chain', row.chain);
    if (delErr) {
      console.error(
        `[cron/yield-rates] sweep delete failed for ${row.protocol}/${row.token}/${row.chain}:`,
        delErr,
      );
      continue;
    }
    swept += 1;
  }

  return { swept, skipped: false };
}

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
