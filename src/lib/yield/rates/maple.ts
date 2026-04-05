import type { RateFetcher, RateResult } from './types';

const GRAPHQL_URL = 'https://api.maple.finance/v2/graphql';

const USDC_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

const POOLS_QUERY = `
  query ActivePools {
    pools(where: { isActive: true }) {
      id
      asset {
        address
        symbol
      }
      totalAssets
      poolApy
    }
  }
`;

interface MaplePool {
  id: string;
  asset: { address: string; symbol: string } | null;
  totalAssets: string | number | null;
  poolApy: number | null;
}

interface MapleResponse {
  data?: {
    pools?: MaplePool[];
  };
}

export const mapleFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: POOLS_QUERY }),
    });
    if (!res.ok) throw new Error(`Maple GraphQL error: ${res.status}`);

    const data = (await res.json()) as MapleResponse;
    const pools = data?.data?.pools ?? [];

    // Filter to USDC pools
    const usdcPools = pools.filter(
      (p) => p.asset?.address?.toLowerCase() === USDC_ADDRESS,
    );

    if (usdcPools.length === 0) return [];

    // Pick highest TVL pool
    const best = usdcPools.reduce<MaplePool>((top, p) => {
      const tvl = Number(p.totalAssets ?? 0);
      const topTvl = Number(top.totalAssets ?? 0);
      return tvl > topTvl ? p : top;
    }, usdcPools[0]);

    const supplyAPY = best.poolApy ?? 0;

    return [
      {
        protocol: 'maple',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
      },
    ];
  },
};
