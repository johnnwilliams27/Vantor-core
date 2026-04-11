import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

const ORACLE_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as const;

// USDY launch: January 2024. Use as the baseline for price-based APY derivation.
const LAUNCH_DATE = new Date('2024-01-01T00:00:00Z');
// USDY started at $1.00
const LAUNCH_PRICE = 1.0;

// Minimal ABI — only getPrice() is needed
const ORACLE_ABI = [
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const SECONDS_PER_YEAR = 31_536_000;

export const ondoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const priceBigInt = await ethereumClient.readContract({
      address: ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: 'getPrice',
    });

    // Price is scaled by 1e18
    const currentPrice = Number(priceBigInt) / 1e18;

    // Derive annualised APY from price accrual since launch
    const now = Date.now();
    const secondsElapsed = (now - LAUNCH_DATE.getTime()) / 1000;

    let supplyAPY = 0;
    if (secondsElapsed > 0 && currentPrice > LAUNCH_PRICE) {
      const growthRatio = currentPrice / LAUNCH_PRICE;
      // APY = growthRatio^(SECONDS_PER_YEAR / secondsElapsed) - 1
      supplyAPY = Math.pow(growthRatio, SECONDS_PER_YEAR / secondsElapsed) - 1;
    }

    return [
      {
        protocol: 'ondo_usdy',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY,
        rewardAPY: 0,
      },
    ];
  },
};
