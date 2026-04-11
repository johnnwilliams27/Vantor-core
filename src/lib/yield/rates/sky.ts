import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

const SUSDS_ADDRESS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD' as const;
const SECONDS_PER_YEAR = 365 * 24 * 3600;

// sUSDS is an ERC-4626 vault wrapping USDS. Both USDS and sUSDS use
// 18 decimals, and USDS is dollar-pegged, so totalAssets() returns
// the pool's USD TVL after dividing by 1e18.
const USDS_DECIMALS = 18;

// Minimal ABI — ssr() for the savings rate and totalAssets() for TVL.
const SUSDS_ABI = [
  {
    name: 'ssr',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const skyFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    // Two independent view calls in parallel.
    const [ssr, totalAssetsRaw] = await Promise.all([
      ethereumClient.readContract({
        address: SUSDS_ADDRESS,
        abi: SUSDS_ABI,
        functionName: 'ssr',
      }),
      ethereumClient
        .readContract({
          address: SUSDS_ADDRESS,
          abi: SUSDS_ABI,
          functionName: 'totalAssets',
        })
        .catch(() => null),
    ]);

    // ssr is a per-second RAY rate (1e27-scaled)
    const ssrFloat = Number(ssr) / 1e27;
    const supplyAPY = Math.pow(ssrFloat, SECONDS_PER_YEAR) - 1;

    const tvlUsd =
      totalAssetsRaw != null
        ? Number(totalAssetsRaw) / 10 ** USDS_DECIMALS
        : null;

    return [
      {
        protocol: 'sky',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
        tvlUsd,
      },
      {
        protocol: 'sky',
        token: 'USDT',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
        tvlUsd,
      },
    ];
  },
};
