import type { RateFetcher, RateResult } from './types';

const BASE_URL = 'https://mainnet-beta.api.drift.trade';
// USDC is market index 0 on Drift
const USDC_MARKET_INDEX = 0;

interface DriftSpotMarket {
  marketIndex?: number;
  symbol?: string;
  depositRate?: number;
  supplyApr?: number;
  supplyApy?: number;
  lendRate?: number;
  [key: string]: unknown;
}

interface DriftSpotMarketsResponse {
  success?: boolean;
  data?: DriftSpotMarket | DriftSpotMarket[];
  result?: DriftSpotMarket | DriftSpotMarket[];
  [key: string]: unknown;
}

function extractAPY(market: DriftSpotMarket): number {
  // Try common field names in descending preference
  return (
    market.supplyApy ??
    market.supplyApr ??
    market.depositRate ??
    market.lendRate ??
    0
  );
}

export const driftFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const url = `${BASE_URL}/spotMarkets?marketIndex=${USDC_MARKET_INDEX}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Drift API error: ${res.status}`);

    const json = (await res.json()) as DriftSpotMarketsResponse;

    // Normalise possible response shapes
    let market: DriftSpotMarket | null = null;
    const payload = json?.data ?? json?.result ?? json;

    if (Array.isArray(payload)) {
      market =
        (payload as DriftSpotMarket[]).find(
          (m) => m.marketIndex === USDC_MARKET_INDEX,
        ) ?? payload[0] ?? null;
    } else if (payload && typeof payload === 'object') {
      market = payload as DriftSpotMarket;
    }

    if (!market) return [];

    const supplyAPY = extractAPY(market);

    return [
      {
        protocol: 'drift',
        token: 'USDC',
        chain: 'solana',
        supplyAPY,
        rewardAPY: 0,
      },
    ];
  },
};
