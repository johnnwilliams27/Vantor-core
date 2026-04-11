// src/lib/policy/canonicalizer/oracle-adapter.ts

import { getStablecoinPrices, getStablecoinPricesStrict } from '@/lib/treasury/oracle';
import { StablecoinPricesResult } from './coingecko-provider';

/**
 * Adapter that bridges the treasury oracle to the policy provider's
 * StablecoinPricesResult shape. Uses getStablecoinPricesStrict in production
 * (no silent fallback, real fetchedAt) and falls back to the fail-open
 * helper only when COINGECKO_USE_MOCK=true. The policy provider's
 * acceptMockSource flag is the dev-mode escape hatch — production wiring
 * MUST leave acceptMockSource at its default false.
 */
export async function fetchStablecoinPricesWithTimestamp(): Promise<StablecoinPricesResult> {
  if (process.env.COINGECKO_USE_MOCK === 'true') {
    // Dev/test mode — use existing fail-open helper which returns source:'mock'
    const oracleResult = await getStablecoinPrices();
    return {
      prices: oracleResult.prices as unknown as Record<string, number>,
      source: oracleResult.source,
      fetchedAt: new Date(),
    };
  }

  // Production mode — strict fetch, throws on any failure
  const strict = await getStablecoinPricesStrict();
  return {
    prices: strict.prices as unknown as Record<string, number>,
    source: strict.source,
    fetchedAt: strict.fetchedAt,
  };
}
