/**
 * Shared DefiLlama yield pools fetcher.
 *
 * Why: several of our native protocol APIs are flaky or require auth
 * (Kamino's endpoint has been 404 for weeks, Drift requires an API key,
 * and the Ethena API doesn't return TVL). DefiLlama's /pools endpoint
 * aggregates all of them in one place and is free + unauthenticated.
 *
 * We use it as:
 *   - Primary source when the native API is broken (Kamino).
 *   - TVL-only supplement when the native API provides APY but not TVL
 *     (Ethena).
 *
 * The endpoint returns the full list (~1–2 MB). Per-cron-cycle, multiple
 * fetchers may want different pool IDs, so we dedupe the fetch via a
 * short in-module cache (30 s). Cron runs every minute, so each run
 * does at most one Llama fetch.
 */

export interface LlamaPool {
  pool: string;          // UUID-like pool ID
  project: string;       // e.g. 'kamino-lend', 'ethena-usde'
  symbol: string;        // e.g. 'USDC', 'SUSDE'
  chain: string;         // e.g. 'Solana', 'Ethereum'
  tvlUsd: number | null;
  apy: number | null;    // in percent (e.g. 2.45 == 2.45%)
  apyBase: number | null;
  apyReward: number | null;
}

interface LlamaResponse {
  status?: string;
  data?: LlamaPool[];
}

const LLAMA_URL = 'https://yields.llama.fi/pools';
const CACHE_TTL_MS = 30_000;

let cache: { data: LlamaPool[] | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
};

export async function getLlamaPools(): Promise<LlamaPool[]> {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  const res = await fetch(LLAMA_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`DefiLlama pools error: ${res.status}`);

  const json = (await res.json()) as LlamaResponse;
  const data = json.data ?? [];
  cache = { data, fetchedAt: now };
  return data;
}

/**
 * Look up a specific pool by its DefiLlama UUID. Returns null if the
 * pool was removed from the DefiLlama dataset (pool IDs can change
 * when Llama rebalances, so callers should handle null gracefully).
 */
export async function getLlamaPool(poolId: string): Promise<LlamaPool | null> {
  const pools = await getLlamaPools();
  return pools.find((p) => p.pool === poolId) ?? null;
}

/**
 * DefiLlama returns APY as a percent (2.45 == 2.45%). Our internal
 * RateResult uses decimal (0.0245 == 2.45%). This helper handles the
 * conversion so callers don't forget.
 */
export function llamaApyToDecimal(apyPct: number | null | undefined): number {
  if (apyPct == null || !Number.isFinite(apyPct)) return 0;
  return apyPct / 100;
}
