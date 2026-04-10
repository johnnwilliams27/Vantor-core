import { ethereumClient } from '../rates/client';
import { COMPOUND_COMET_USDC, COMPOUND_COMET_USDT, COMPOUND_COMET_ABI } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const COMET_MAP: Record<string, `0x${string}`> = { USDC: COMPOUND_COMET_USDC, USDT: COMPOUND_COMET_USDT };
const DECIMALS = 6;

export async function getCompoundOnChainValue(walletAddress: string, token: TokenSymbol): Promise<OnChainValue> {
  const cometAddress = COMET_MAP[token];
  if (!cometAddress) return { currentValueUsd: 0, yieldTokenBalance: 0 };

  const balance = await ethereumClient.readContract({
    address: cometAddress, abi: COMPOUND_COMET_ABI, functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;
  return { currentValueUsd: balanceFloat, yieldTokenBalance: balanceFloat };
}
