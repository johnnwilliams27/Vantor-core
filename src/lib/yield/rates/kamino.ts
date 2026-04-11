import type { RateFetcher, RateResult } from './types';

// Kamino Main Market on Solana
const MARKET_ADDRESS = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const API_URL = `https://api.kamino.finance/kamino-market/${MARKET_ADDRESS}/reserves`;

// Leveraged multiplier for Kamino Multiply product
const MULTIPLY_LEVERAGE = 2.5;

interface KaminoReserve {
  symbol?: string;
  mintAddress?: string;
  stats?: {
    supplyInterestAPY?: number;
    supplyAPY?: number;
    // Kamino exposes TVL under various field names depending on endpoint
    // version. We probe several in priority order and take the first
    // finite numeric value.
    totalSupplyUsd?: number | string;
    totalLiquidityUsd?: number | string;
    totalSupply?: number | string;
    mintTotalSupply?: number | string;
    availableAmount?: number | string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function getBaseAPY(reserve: KaminoReserve): number {
  return (
    reserve.stats?.supplyInterestAPY ??
    reserve.stats?.supplyAPY ??
    0
  );
}

function toFiniteNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function getTvlUsd(reserve: KaminoReserve): number | null {
  const stats = reserve.stats;
  if (!stats) return null;
  // Preferred: a pre-computed USD field.
  const usd =
    toFiniteNumber(stats.totalSupplyUsd) ??
    toFiniteNumber(stats.totalLiquidityUsd);
  if (usd != null) return usd;
  // For USDC/USDT reserves the native total supply is already dollar-pegged
  // (the Kamino API returns it as a human-readable number, not base units).
  const native =
    toFiniteNumber(stats.totalSupply) ?? toFiniteNumber(stats.mintTotalSupply);
  return native;
}

export const kaminoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(API_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Kamino API error: ${res.status}`);

    const reserves: KaminoReserve[] = await res.json();
    const results: RateResult[] = [];

    const tokens = ['USDC', 'USDT'];
    for (const token of tokens) {
      const reserve = reserves.find(
        (r) => r.symbol?.toUpperCase() === token,
      );
      if (!reserve) continue;

      const baseAPY = getBaseAPY(reserve);
      const tvlUsd = getTvlUsd(reserve);

      // Standard Kamino Lend rate
      results.push({
        protocol: 'kamino',
        token,
        chain: 'solana',
        supplyAPY: baseAPY,
        rewardAPY: 0,
        tvlUsd,
      });

      // Kamino Multiply (leveraged) — same underlying pool, so TVL is
      // shared. APY is approximated as base × leverage.
      results.push({
        protocol: 'kamino_multiply',
        token,
        chain: 'solana',
        supplyAPY: baseAPY * MULTIPLY_LEVERAGE,
        rewardAPY: 0,
        tvlUsd,
      });
    }

    return results;
  },
};
