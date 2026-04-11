import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as const;
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840' as const;

const SECONDS_PER_YEAR = 31_536_000;

// USDC and USDT Comets both use 6-decimal base tokens. totalSupply()
// returns in those base-token units, which equals USD for stablecoins.
const STABLECOIN_DECIMALS = 6;

// Minimal ABI — getUtilization + getSupplyRate + totalSupply
const COMET_ABI = [
  {
    name: 'getUtilization',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getSupplyRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'utilization', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint64' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

async function fetchCometRate(comet: `0x${string}`, token: string): Promise<RateResult> {
  // Three view calls in parallel — same contract, no dependency between them.
  const [utilization, totalSupplyRaw] = await Promise.all([
    ethereumClient.readContract({
      address: comet,
      abi: COMET_ABI,
      functionName: 'getUtilization',
    }),
    ethereumClient.readContract({
      address: comet,
      abi: COMET_ABI,
      functionName: 'totalSupply',
    }).catch(() => null),
  ]);

  const supplyRatePerSecond = await ethereumClient.readContract({
    address: comet,
    abi: COMET_ABI,
    functionName: 'getSupplyRate',
    args: [utilization],
  });

  // Rate is scaled by 1e18
  const ratePerSecond = Number(supplyRatePerSecond) / 1e18;
  const supplyAPY = Math.pow(1 + ratePerSecond, SECONDS_PER_YEAR) - 1;

  const tvlUsd =
    totalSupplyRaw !== null ? Number(totalSupplyRaw) / 10 ** STABLECOIN_DECIMALS : null;

  return {
    protocol: 'compound',
    token,
    chain: 'ethereum',
    supplyAPY,
    rewardAPY: 0,
    tvlUsd,
  };
}

export const compoundFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const [usdc, usdt] = await Promise.all([
      fetchCometRate(USDC_COMET, 'USDC'),
      fetchCometRate(USDT_COMET, 'USDT'),
    ]);
    return [usdc, usdt];
  },
};
