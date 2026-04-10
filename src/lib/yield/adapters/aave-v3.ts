import { ethereumClient } from '../rates/client';
import { AAVE_AUSDC, AAVE_AUSDT, ERC20_BALANCE_ABI } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const ATOKEN_MAP: Record<string, `0x${string}`> = { USDC: AAVE_AUSDC, USDT: AAVE_AUSDT };
const DECIMALS = 6;

export async function getAaveOnChainValue(walletAddress: string, token: TokenSymbol): Promise<OnChainValue> {
  const aTokenAddress = ATOKEN_MAP[token];
  if (!aTokenAddress) return { currentValueUsd: 0, yieldTokenBalance: 0 };

  const balance = await ethereumClient.readContract({
    address: aTokenAddress, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;
  return { currentValueUsd: balanceFloat, yieldTokenBalance: balanceFloat };
}
