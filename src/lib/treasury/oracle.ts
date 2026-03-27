import type { StablecoinPrices } from '@/types/database';

const MOCK_MODE = process.env.COINGECKO_USE_MOCK !== 'false';

const MOCK_PRICES: StablecoinPrices = {
  USDC: 1.0,
  USDT: 1.0,
};

export type OraclePriceSource = 'mock' | 'coingecko';

export interface OraclePricesResult {
  prices: StablecoinPrices;
  source: OraclePriceSource;
}

/**
 * Fetches current stablecoin prices from CoinGecko.
 * In mock mode (COINGECKO_USE_MOCK=true), returns 1:1 USD prices.
 * Uses Next.js 5-minute server cache in real mode.
 * Falls back to 1.0 on any error — never throws.
 */
export async function getStablecoinPrices(): Promise<OraclePricesResult> {
  if (MOCK_MODE) {
    return { prices: { ...MOCK_PRICES }, source: 'mock' };
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,tether&vs_currencies=usd',
      { next: { revalidate: 300 } }
    );

    if (!res.ok) {
      console.warn('[Oracle] CoinGecko returned non-OK status, falling back to 1.0 prices');
      return { prices: { ...MOCK_PRICES }, source: 'coingecko' };
    }

    const json = await res.json();

    const prices: StablecoinPrices = {
      USDC: json['usd-coin']?.usd ?? 1.0,
      USDT: json['tether']?.usd ?? 1.0,
    };

    return { prices, source: 'coingecko' };
  } catch (err) {
    console.warn('[Oracle] CoinGecko fetch failed, falling back to 1.0 prices:', err);
    return { prices: { ...MOCK_PRICES }, source: 'coingecko' };
  }
}

/**
 * Returns the USD value of a token balance using the given price map.
 * Falls back to 1.0 if the token is not found.
 */
export function priceToken(token: string, balance: number, prices: StablecoinPrices): number {
  const priceMap = prices as unknown as Record<string, number>;
  return balance * (priceMap[token] ?? 1.0);
}
