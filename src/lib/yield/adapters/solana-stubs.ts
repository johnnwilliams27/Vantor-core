import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

/**
 * Kamino and Drift (Solana) position queries are stubbed.
 * They return stored DB values until SDK integration is implemented.
 */
export async function getKaminoOnChainValue(
  _walletAddress: string, _token: TokenSymbol, storedValue: number, storedTokenBalance: number,
): Promise<OnChainValue> {
  console.warn('[yield/kamino] On-chain position query not yet implemented, using stored value');
  return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
}

export async function getDriftOnChainValue(
  _walletAddress: string, _token: TokenSymbol, storedValue: number, storedTokenBalance: number,
): Promise<OnChainValue> {
  console.warn('[yield/drift] On-chain position query not yet implemented, using stored value');
  return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
}
