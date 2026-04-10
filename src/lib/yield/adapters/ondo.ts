import { ethereumClient } from '../rates/client';
import { ONDO_USDY, ERC20_BALANCE_ABI } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const DECIMALS = 18;

async function getUsdyPrice(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ondo-us-dollar-yield&vs_currencies=usd',
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return 1.0;
    const data = await res.json();
    return data['ondo-us-dollar-yield']?.usd ?? 1.0;
  } catch {
    return 1.0;
  }
}

export async function getOndoOnChainValue(walletAddress: string, _token: TokenSymbol): Promise<OnChainValue> {
  const balance = await ethereumClient.readContract({
    address: ONDO_USDY, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;
  const usdyPrice = await getUsdyPrice();
  return { currentValueUsd: balanceFloat * usdyPrice, yieldTokenBalance: balanceFloat };
}
