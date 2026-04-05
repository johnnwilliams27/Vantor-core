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

      // Standard Kamino Lend rate
      results.push({
        protocol: 'kamino',
        token,
        chain: 'solana',
        supplyAPY: baseAPY,
        rewardAPY: 0,
      });

      // Kamino Multiply (leveraged) — approximate as base * leverage
      results.push({
        protocol: 'kamino_multiply',
        token,
        chain: 'solana',
        supplyAPY: baseAPY * MULTIPLY_LEVERAGE,
        rewardAPY: 0,
      });
    }

    return results;
  },
};
