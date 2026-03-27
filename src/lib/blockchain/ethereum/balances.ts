import { getEthereumClient } from './client';
import { ETH_TOKEN_ADDRESSES } from '@/types/blockchain';
import type { TokenSymbol, TokenBalance } from '@/types/blockchain';
import Big from 'big.js';

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  USDC: 6,
  USDT: 6,
};

export async function fetchEthereumBalances(
  address: string
): Promise<TokenBalance[]> {
  const client = getEthereumClient();
  const tokens: TokenSymbol[] = ['USDC', 'USDT'];

  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      const contractAddress = ETH_TOKEN_ADDRESSES[token];
      const balance = await client.readContract({
        address: contractAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      });
      const decimals = TOKEN_DECIMALS[token];
      const humanBalance = new Big(balance.toString())
        .div(new Big(10).pow(decimals))
        .toFixed(6);
      return { token, balance: humanBalance, decimals } as TokenBalance;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TokenBalance> => r.status === 'fulfilled')
    .map((r) => r.value);
}
