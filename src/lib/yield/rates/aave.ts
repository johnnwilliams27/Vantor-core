import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

const POOL_ADDRESS = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const;
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;

const RAY = BigInt('1000000000000000000000000000'); // 10^27
const SECONDS_PER_YEAR = 31_536_000;

// Both USDC and USDT on mainnet use 6 decimals; value-in-USD == value-in-token
// for stablecoins, so no price oracle is needed to compute pool USD TVL.
const STABLECOIN_DECIMALS = 6;

// Minimal ABI — only getReserveData is needed
const POOL_ABI = [
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'configuration', type: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'currentLiquidityRate', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
          { name: 'currentVariableBorrowRate', type: 'uint128' },
          { name: 'currentStableBorrowRate', type: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40' },
          { name: 'id', type: 'uint16' },
          { name: 'aTokenAddress', type: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address' },
          { name: 'accruedToTreasury', type: 'uint128' },
          { name: 'unbacked', type: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128' },
        ],
      },
    ],
  },
] as const;

// ERC20 totalSupply — used against the aToken to read pool TVL
const ERC20_ABI = [
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

function rayRateToAPY(rayRate: bigint): number {
  // ratePerSecond = rayRate / RAY / SECONDS_PER_YEAR
  // APY = (1 + ratePerSecond)^SECONDS_PER_YEAR - 1
  const ratePerSecond = Number(rayRate) / Number(RAY) / SECONDS_PER_YEAR;
  return Math.pow(1 + ratePerSecond, SECONDS_PER_YEAR) - 1;
}

async function fetchTokenRate(asset: `0x${string}`, token: string): Promise<RateResult> {
  const data = await ethereumClient.readContract({
    address: POOL_ADDRESS,
    abi: POOL_ABI,
    functionName: 'getReserveData',
    args: [asset],
  });

  const supplyAPY = rayRateToAPY(BigInt(data.currentLiquidityRate));

  // aToken.totalSupply() returns supplied + accrued interest in the
  // underlying token's units. For a stablecoin that's already USD.
  let tvlUsd: number | null = null;
  try {
    const aTokenTotalSupply = await ethereumClient.readContract({
      address: data.aTokenAddress,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
    });
    tvlUsd = Number(aTokenTotalSupply) / 10 ** STABLECOIN_DECIMALS;
  } catch {
    // Leave tvlUsd null — the APY row is still useful without it.
  }

  return {
    protocol: 'aave',
    token,
    chain: 'ethereum',
    supplyAPY,
    rewardAPY: 0,
    tvlUsd,
  };
}

export const aaveFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const [usdc, usdt] = await Promise.all([
      fetchTokenRate(USDC_ADDRESS, 'USDC'),
      fetchTokenRate(USDT_ADDRESS, 'USDT'),
    ]);
    return [usdc, usdt];
  },
};
