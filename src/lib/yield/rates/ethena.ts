import type { RateFetcher, RateResult } from './types';
import { getLlamaPool } from './llama';

/**
 * Ethena's public yield endpoint returns APY for sUSDe.
 * Shape (verified 2026-04-11):
 *   {
 *     "avg30dSusdeYield":  { "lastUpdated": "...", "value": 3.51 },
 *     "stakingYield":      { "lastUpdated": "...", "value": 3.51 },
 *     "protocolYield":     { "lastUpdated": "...", "value": 4.21 },
 *     ...
 *   }
 * All values are in PERCENT (3.51 == 3.51%). Our internal RateResult
 * uses decimal (0.0351 == 3.51%), so we divide by 100.
 */
const ETHENA_API_URL =
  'https://ethena.fi/api/yields/protocol-and-staking-yield';

/**
 * DefiLlama pool ID for Ethena sUSDe staking. The native Ethena endpoint
 * above only exposes yield, not TVL, so we pull TVL from DefiLlama.
 *
 * Stable pool ID — verified against yields.llama.fi/pools (project:
 * ethena-usde, symbol: SUSDE, chain: Ethereum).
 */
const ETHENA_SUSDE_LLAMA_POOL = '66985a81-9c51-46ca-9977-42b4fe7bc6df';

interface ValueWrapper {
  value?: number;
  lastUpdated?: string;
}

interface EthenaResponse {
  avg30dSusdeYield?: ValueWrapper;
  stakingYield?: ValueWrapper | number;
  protocolYield?: ValueWrapper | number;
  sUSDe?: { apy?: number };
  [key: string]: unknown;
}

function extractSUsdeAPY(data: unknown): number {
  if (!data || typeof data !== 'object') return 0;
  const obj = data as EthenaResponse;

  // Preferred: the headline stakingYield figure (current APY).
  const staking = obj.stakingYield;
  if (staking != null) {
    if (typeof staking === 'object' && typeof staking.value === 'number') {
      return staking.value / 100;
    }
    if (typeof staking === 'number') return staking / 100;
  }

  // Fallback: 30-day average sUSDe yield.
  const avg30d = obj.avg30dSusdeYield;
  if (avg30d && typeof avg30d.value === 'number') {
    return avg30d.value / 100;
  }

  // Legacy flat shape: { sUSDe: { apy: 0.12 } } — already decimal here.
  if (obj.sUSDe && typeof obj.sUSDe.apy === 'number') {
    return obj.sUSDe.apy;
  }

  return 0;
}

export const ethenaFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    // Fire APY (native) and TVL (DefiLlama) in parallel. Both are
    // non-fatal individually — if one fails we still return the other
    // with a null where appropriate.
    const [apyResult, llamaPool] = await Promise.allSettled([
      fetch(ETHENA_API_URL, { headers: { Accept: 'application/json' } }).then(
        async (res) => {
          if (!res.ok) throw new Error(`Ethena API error: ${res.status}`);
          return res.json();
        },
      ),
      getLlamaPool(ETHENA_SUSDE_LLAMA_POOL),
    ]);

    let supplyAPY = 0;
    if (apyResult.status === 'fulfilled') {
      supplyAPY = extractSUsdeAPY(apyResult.value);
    }

    const tvlUsd =
      llamaPool.status === 'fulfilled' && llamaPool.value?.tvlUsd != null
        ? llamaPool.value.tvlUsd
        : null;

    // If both sources fail we still want to throw so the cron marks
    // the row stale rather than silently writing zero APY.
    if (apyResult.status === 'rejected' && llamaPool.status === 'rejected') {
      throw new Error(
        `Ethena both sources failed: ${apyResult.reason} / ${llamaPool.reason}`,
      );
    }

    return [
      {
        protocol: 'ethena',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
        tvlUsd,
      },
      {
        protocol: 'ethena',
        token: 'USDT',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
        tvlUsd,
      },
    ];
  },
};
