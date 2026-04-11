import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/admin';
import { getYieldAdapter, ALL_YIELD_PROTOCOLS } from '@/lib/yield/factory';
import type { YieldProtocolId, YieldRate } from '@/lib/yield/interface';

/**
 * The fetchers under src/lib/yield/rates use short protocol slugs for
 * two protocols that the UI/adapter layer knows as longer IDs. Normalize
 * the cache rows to the adapter IDs on read so the join works.
 *
 * TODO: update the fetchers themselves to emit YieldProtocolId values
 * and delete this map — tracked separately because it involves clearing
 * stale cache rows with the old slugs.
 */
const CACHE_SLUG_TO_PROTOCOL_ID: Record<string, YieldProtocolId> = {
  aave: 'aave_v3',
  compound: 'compound_v3',
};

function normalizeProtocolSlug(slug: string): string {
  return CACHE_SLUG_TO_PROTOCOL_ID[slug] ?? slug;
}

interface CacheRow {
  protocol: string;
  token: string;
  chain: string;
  supply_apy: number | string;
  reward_apy: number | string;
  total_apy: number | string;
  tvl_usd: number | string | null;
  fetched_at: string;
  is_stale: boolean;
}

function rowToRate(row: CacheRow, protocolId: YieldProtocolId): YieldRate {
  return {
    protocol: protocolId,
    token: row.token as YieldRate['token'],
    chain: row.chain as YieldRate['chain'],
    supplyAPY: Number(row.supply_apy),
    rewardAPY: Number(row.reward_apy),
    totalAPY: Number(row.total_apy),
    tvlUsd: row.tvl_usd != null ? Number(row.tvl_usd) : null,
    fetchedAt: row.fetched_at,
    isStale: row.is_stale,
  };
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();

  // Load country for the Ondo geo-gate + the rate cache for real-data merge.
  // Both queries are independent — fetch in parallel.
  const enterpriseId = session.user.enterprise_id;
  const [enterpriseResult, cacheResult] = await Promise.all([
    enterpriseId
      ? supabase
          .from('enterprises')
          .select('country')
          .eq('id', enterpriseId)
          .single()
      : Promise.resolve({ data: null as { country: string | null } | null }),
    supabase.from('yield_rate_cache').select('*'),
  ]);

  const enterpriseCountry = enterpriseResult.data?.country ?? null;
  const cacheRows = (cacheResult.data ?? []) as CacheRow[];

  // Index cache rows by (normalized protocol id, token) for O(1) lookup
  // when merging into the per-protocol rate lists.
  const cacheIndex = new Map<string, CacheRow>();
  for (const row of cacheRows) {
    const normalized = normalizeProtocolSlug(row.protocol);
    cacheIndex.set(`${normalized}:${row.token}`, row);
  }

  const protocols = await Promise.all(
    ALL_YIELD_PROTOCOLS.map(async (pid) => {
      const adapter = getYieldAdapter(pid);
      const info = adapter.getInfo();

      // Prefer cache rows (real on-chain / API data). Fall back to the
      // adapter's getAPY() only when a cache row doesn't exist yet — that
      // happens on a fresh deploy before the first cron run, or for a
      // protocol whose fetcher hasn't been implemented.
      const rates: YieldRate[] = await Promise.all(
        info.supportedTokens.map(async (token) => {
          const cached = cacheIndex.get(`${pid}:${token}`);
          if (cached) return rowToRate(cached, pid);
          return adapter.getAPY(token);
        }),
      );

      return { ...info, rates };
    }),
  );

  // Filter out Ondo for US enterprises
  const filteredProtocols = protocols.filter((p) => {
    if (p.id === 'ondo') {
      return enterpriseCountry && enterpriseCountry !== 'US';
    }
    return true;
  });

  return NextResponse.json({ data: filteredProtocols });
}
