import type { ChainType, TokenSymbol } from '@/types/database';

// ---- Ramp (on/off-ramp) ----

export interface RampQuoteParams {
  direction: 'onramp' | 'offramp';
  cryptoToken: 'USDC' | 'USDT' | 'PYUSD';
  fiatCurrency: string;
  /** Provide one of the two amounts; the adapter derives the other */
  cryptoAmount?: number;
  fiatAmount?: number;
}

export interface RampQuote {
  cryptoAmount: number;
  fiatAmount: number;
  exchangeRate: number;
  feeAmount: number;
  /** Fiat currency code (USD, EUR, GBP) */
  fiatCurrency?: string;
  /** FX rate applied (undefined if USD) */
  fxRate?: number;
  /** ISO timestamp */
  expiresAt: string;
  vantor_fee?: number;
}

export interface RampExecuteParams {
  direction: 'onramp' | 'offramp';
  cryptoToken: string;
  cryptoAmount: number;
  fiatAmount: number;
  fiatCurrency: string;
  exchangeRate: number;
  feeAmount: number;
  /** Bank account external reference (e.g. Plaid account ID or internal ID) */
  bankAccountRef?: string;
}

export interface RampResult {
  providerTransactionId: string;
  status: string;
  settledAt: string | null;
}

// ---- Swap (same chain, different token) ----

export interface SwapQuoteParams {
  chain: ChainType;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  amount: string;
  slippageBps?: number;
  walletAddress: string;
}

export interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  rate: string;
  slippageBps: number;
  priceImpact?: string;
  feeAmount?: string;
  quoteData: Record<string, unknown>;
  vantor_fee?: number;
}

export interface SwapExecuteParams {
  chain: ChainType;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  fromAmount: string;
  toAmount: string;
  walletAddress: string;
  quoteData: Record<string, unknown>;
}

export interface SwapResult {
  txHash: string | null;
  providerRef: string;
  status: 'pending' | 'completed';
}

// ---- Bridge (cross-chain, same token) ----

export interface BridgeQuoteParams {
  token: TokenSymbol;
  amount: string;
  fromChain: ChainType;
  toChain: ChainType;
  walletAddress: string;
}

export interface BridgeQuote {
  token: string;
  fromChain: string;
  toChain: string;
  fromAmount: string;
  toAmount: string;
  bridgeFee: string;
  estimatedTimeMinutes: number;
  provider: string;
  quoteData: Record<string, unknown>;
  vantor_fee?: number;
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
  providerRef: string;
  status: 'pending' | 'completed';
  estimatedArrivalMinutes: number;
}

// ---- Unified adapter ----

export interface IBankingAdapter {
  // Ramps (fiat ↔ crypto)
  getRampQuote(params: RampQuoteParams): Promise<RampQuote>;
  executeRamp(params: RampExecuteParams): Promise<RampResult>;

  // Swaps (same chain, token → token)
  getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote>;
  executeSwap(params: SwapExecuteParams): Promise<SwapResult>;

  // Bridges (cross-chain, same token)
  getBridgeQuote(params: BridgeQuoteParams): Promise<BridgeQuote>;
  executeBridge(params: BridgeExecuteParams): Promise<BridgeExecuteResult>;
}
