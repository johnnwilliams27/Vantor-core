import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { getSolanaConnection } from './client';
import { SOL_TOKEN_ADDRESSES } from '@/types/blockchain';
import type { TokenBalance } from '@/types/blockchain';
import type { TokenSymbol } from '@/types/database';
import Big from 'big.js';

const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
};

export async function fetchSolanaBalances(
  address: string
): Promise<TokenBalance[]> {
  const connection = getSolanaConnection();
  const ownerPubkey = new PublicKey(address);
  const tokens: TokenSymbol[] = ['USDC', 'USDT', 'PYUSD'];

  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      const mintAddress = new PublicKey(SOL_TOKEN_ADDRESSES[token]);
      const ata = await getAssociatedTokenAddress(mintAddress, ownerPubkey);
      try {
        const accountInfo = await getAccount(connection, ata);
        const decimals = TOKEN_DECIMALS[token];
        const humanBalance = new Big(accountInfo.amount.toString())
          .div(new Big(10).pow(decimals))
          .toFixed(6);
        return { token, balance: humanBalance, decimals } as TokenBalance;
      } catch {
        // ATA doesn't exist → zero balance
        return { token, balance: '0.000000', decimals: TOKEN_DECIMALS[token] } as TokenBalance;
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TokenBalance> => r.status === 'fulfilled')
    .map((r) => r.value);
}
