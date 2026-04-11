import type { ChainType, TokenSymbol } from '@/types/database';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PoolLiquidity, ILiquidityProvider } from './interface';

/**
 * Liquidity provider that sources TVL from the yield_rate_cache table,
 * which is refreshed every minute by /api/cron/yield-rates.
 *
 * Replaces the prior MockLiquidityProvider, which had hardcoded TVL
 * constants that drifted from reality.
 *
 * Note on utilization: the real utilization rate is *not* yet in the
 * cache (it would require additional on-chain reads for Aave/Compound
 * and extended API payloads for Morpho/Kamino). We use conservative
 * per-pool-type defaults below. This is a smaller lie than mock TVL
 * because utilization on mature lending markets typically sits in a
 * narrow band (~0.75–0.85) and moves slowly. Tracked as a follow-up.
 */

// Fallback TVL for protocols where the cache has no row yet (fresh deploy
// pre-first-cron, or a protocol whose fetcher hasn't been implemented).
// These values are intentionally small so the slippage engine errs on the
// side of suggesting more tranches rather than under-estimating impact.
const FALLBACK_TVL: Record<YieldProtocolId, number> = {
  aave_v3:           500_000_000,
  compound_v3:       300_000_000,
  morpho_reservoir:  50_000_000,
  morpho_steakhouse: 30_000_000,
  kamino:            80_000_000,
  kamino_multiply:   15_000_000,
  ondo:              100_000_000,
  sky:               200_000_000,
  ethena:            500_000_000,
};

const POOL_TYPE: Record<YieldProtocolId, 'stablecoin' | 'volatile'> = {
  aave_v3:           'stablecoin',
  compound_v3:       'stablecoin',
  morpho_reservoir:  'stablecoin',
  morpho_steakhouse: 'stablecoin',
  kamino:            'stablecoin',
  kamino_multiply:   'volatile',  // leveraged, more sensitive to size
  ondo:              'stablecoin',
  sky:               'stablecoin',
  ethena:            'volatile',  // synthetic dollar, delta-neutral basis
};

// Utilization is not yet in the cache — see file-level comment.
// Stablecoin money-market utilization sits ~0.80 on mature venues.
const DEFAULT_UTILIZATION: Record<'stablecoin' | 'volatile', number> = {
  stablecoin: 0.80,
  volatile:   0.70,
};

// Fetchers use short slugs for two protocols that the adapter layer
// knows as longer IDs. Normalize when looking up.
const PROTOCOL_ID_TO_CACHE_SLUG: Record<YieldProtocolId, string> = {
  aave_v3:           'aave',
  compound_v3:       'compound',
  morpho_reservoir:  'morpho_reservoir',
  morpho_steakhouse: 'morpho_steakhouse',
  kamino:            'kamino',
  kamino_multiply:   'kamino_multiply',
  ondo:              'ondo',
  sky:               'sky',
  ethena:            'ethena',
};

export class DbLiquidityProvider implements ILiquidityProvider {
  async getPoolLiquidity(
    protocol: YieldProtocolId,
    chain: ChainType,
    token: TokenSymbol,
  ): Promise<PoolLiquidity> {
    const supabase = createAdminClient();
    const cacheSlug = PROTOCOL_ID_TO_CACHE_SLUG[protocol];

    const { data } = await supabase
      .from('yield_rate_cache')
      .select('tvl_usd, fetched_at, is_stale')
      .eq('protocol', cacheSlug)
      .eq('token', token)
      .eq('chain', chain)
      .maybeSingle();

    const poolType = POOL_TYPE[protocol];
    const utilizationRate = DEFAULT_UTILIZATION[poolType];

    const tvlFromCache =
      data?.tvl_usd != null ? Number(data.tvl_usd) : null;
    const totalLiquidityUsd =
      tvlFromCache != null && Number.isFinite(tvlFromCache) && tvlFromCache > 0
        ? tvlFromCache
        : FALLBACK_TVL[protocol];

    const sourceUsed: 'cache' | 'fallback' =
      tvlFromCache != null && tvlFromCache > 0 ? 'cache' : 'fallback';

    return {
      protocol,
      chain,
      token,
      totalLiquidityUsd,
      availableLiquidityUsd: totalLiquidityUsd * (1 - utilizationRate),
      utilizationRate,
      poolType,
      metadata: {
        source: sourceUsed,
        cachedAt: data?.fetched_at ?? null,
        isStale: data?.is_stale ?? false,
        // Flag that utilization is a default, not a real-time read.
        utilizationSource: 'default',
      },
      fetchedAt: new Date().toISOString(),
    };
  }
}

// Factory — single source of truth for which provider the app uses.
export function getLiquidityProvider(): ILiquidityProvider {
  return new DbLiquidityProvider();
}
