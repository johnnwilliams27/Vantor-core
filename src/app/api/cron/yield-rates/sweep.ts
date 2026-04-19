import type { SupabaseClient } from '@supabase/supabase-js';
import type { RateKey } from '@/lib/yield/rates';

/**
 * Delete any row whose (protocol, token, chain) is not in `declared`. Runs
 * after upserts + stale-marks so that retiring a venue or a fetcher no longer
 * emitting a tuple (e.g. the 2026-04-19 `kamino_multiply` removal) causes the
 * row to self-evict on the next tick, instead of zombie-ing forever.
 *
 * Guarded against an empty `declared` list: if we lost the fetcher aggregator
 * somehow, we must not wipe the whole cache.
 *
 * Lives in a sibling module rather than `route.ts` because Next.js App Router
 * route files can only export HTTP method handlers — any other named export
 * fails the build with a `{ [x: string]: never }` type error.
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
