import type { ChainType, TokenSymbol } from '@/types/database';

export type BridgeProvider = 'cctp' | 'layerzero';

export interface BridgeQuoteParams {
  token: TokenSymbol;
  amount: string; // human-readable
  fromChain: ChainType;
  toChain: ChainType;
  walletAddress: string;
}

export interface BridgeQuoteResponse {
  token: string;
  fromChain: string;
  toChain: string;
  fromAmount: string;
  toAmount: string; // after fees
  bridgeFee: string;
  estimatedTimeMinutes: number;
  provider: BridgeProvider;
  quoteData: Record<string, unknown>;
}

export interface BridgeExecuteParams {
  token: TokenSymbol;
  amount: string;
  fromChain: ChainType;
  toChain: ChainType;
  walletAddress: string;
  quoteData: Record<string, unknown>;
}

export interface BridgeExecuteResult {
  txHash: string | null;
  provider: BridgeProvider;
  status: 'pending' | 'completed';
  estimatedArrivalMinutes: number;
}

export interface IBridgeAdapter {
  getQuote(params: BridgeQuoteParams): Promise<BridgeQuoteResponse>;
  execute(params: BridgeExecuteParams): Promise<BridgeExecuteResult>;
}

/**
 * Returns the bridge provider for a given token:
 * - USDC: Circle CCTP (native cross-chain)
 * - USDT, PYUSD: LayerZero OFT
 */
export function getBridgeProviderForToken(token: TokenSymbol): BridgeProvider {
  if (token === 'USDC') return 'cctp';
  return 'layerzero';
}
