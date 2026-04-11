import type { StablecoinPrices } from '@/types/database';

const MOCK_MODE = process.env.COINGECKO_USE_MOCK === 'true';

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

/**
 * Result type for the strict oracle path. Source is locked to 'coingecko' —
 * the strict helper refuses mock mode.
 */
export interface OraclePricesStrictResult {
  prices: StablecoinPrices;
  source: 'coingecko';
  fetchedAt: Date;
}

/**
 * Strict CoinGecko fetch for policy-critical reads. Unlike getStablecoinPrices,
 * this NEVER returns a fallback value — every failure mode throws an Error
 * with a descriptive message. Used by the policy engine canonicalizer where
 * silently returning 1.0 during a depeg event would corrupt rule evaluation.
 *
 * Differences from getStablecoinPrices:
 *   - Refuses mock mode (throws if COINGECKO_USE_MOCK=true) — strict callers
 *     must wire mock data through the policy provider's acceptMockSource path.
 *   - cache: 'no-store' — every call hits the network.
 *   - 5-second AbortController timeout — a hung CoinGecko fetch would
 *     otherwise block policy evaluation indefinitely.
 *   - fetchedAt is captured after the response body is parsed, so it reflects
 *     when fresh data became available — not when the request was sent. This
 *     is the strictest reasonable interpretation and matches the freshness
 *     contract the policy engine relies on.
 *   - Validates response shape: refuses partial/missing/non-numeric prices.
 *   - Validates prices are positive finite numbers: refuses 0, negative, NaN,
 *     Infinity. (The existing helper accepts whatever CoinGecko sends.)
 *   - Throws Error (not OraclePricesResult) on every failure mode.
 */
export async function getStablecoinPricesStrict(): Promise<OraclePricesStrictResult> {
  if (process.env.COINGECKO_USE_MOCK === 'true') {
    throw new Error(
      'getStablecoinPricesStrict: COINGECKO_USE_MOCK=true — strict helper requires a real CoinGecko fetch. Wire mock data through the policy provider acceptMockSource flag instead.',
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  let res: Response;
  try {
    res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,tether&vs_currencies=usd',
      { cache: 'no-store', signal: controller.signal },
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(
        'getStablecoinPricesStrict: CoinGecko request timed out after 5000ms',
      );
    }
    throw new Error(
      `getStablecoinPricesStrict: CoinGecko fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(
      `getStablecoinPricesStrict: CoinGecko returned non-OK status ${res.status}`,
    );
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new Error(
      `getStablecoinPricesStrict: CoinGecko response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Captured after the response body is parsed, so it reflects when fresh
  // data became available — not when the request was sent.
  const fetchedAt = new Date();

  // Validate response shape defensively — refuse partial data
  const root = json as Record<string, unknown> | null | undefined;
  const usdcRaw = (root?.['usd-coin'] as Record<string, unknown> | undefined)?.['usd'];
  const usdtRaw = (root?.['tether'] as Record<string, unknown> | undefined)?.['usd'];

  if (typeof usdcRaw !== 'number' || typeof usdtRaw !== 'number') {
    throw new Error(
      `getStablecoinPricesStrict: CoinGecko response missing or non-numeric prices (usdc=${typeof usdcRaw}, usdt=${typeof usdtRaw})`,
    );
  }

  if (!Number.isFinite(usdcRaw) || !Number.isFinite(usdtRaw) || usdcRaw <= 0 || usdtRaw <= 0) {
    throw new Error(
      `getStablecoinPricesStrict: CoinGecko returned invalid prices (usdc=${usdcRaw}, usdt=${usdtRaw}) — strict helper requires positive finite numbers`,
    );
  }

  return {
    prices: { USDC: usdcRaw, USDT: usdtRaw },
    source: 'coingecko',
    fetchedAt,
  };
}
