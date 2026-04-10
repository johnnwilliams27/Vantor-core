import { ethereumClient } from '../rates/client';
import { ONDO_USDY, ERC20_BALANCE_ABI } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const DECIMALS = 18;

export async function getOndoOnChainValue(walletAddress: string, _token: TokenSymbol): Promise<OnChainValue> {
  const balance = await ethereumClient.readContract({
    address: ONDO_USDY, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;
  // USDY accrues value through price appreciation — approximate 1:1 for now
  return { currentValueUsd: balanceFloat, yieldTokenBalance: balanceFloat };
}
