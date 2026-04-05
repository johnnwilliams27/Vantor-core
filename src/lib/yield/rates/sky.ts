import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

const SUSDS_ADDRESS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD' as const;
const SECONDS_PER_YEAR = 365 * 24 * 3600;

// Minimal ABI — only ssr() is needed
const SUSDS_ABI = [
  {
    name: 'ssr',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const skyFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const ssr = await ethereumClient.readContract({
      address: SUSDS_ADDRESS,
      abi: SUSDS_ABI,
      functionName: 'ssr',
    });

    // ssr is a per-second RAY rate (1e27-scaled)
    const ssrFloat = Number(ssr) / 1e27;
    const supplyAPY = Math.pow(ssrFloat, SECONDS_PER_YEAR) - 1;

    return [
      {
        protocol: 'sky',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
      },
      {
        protocol: 'sky',
        token: 'USDT',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
      },
    ];
  },
};
