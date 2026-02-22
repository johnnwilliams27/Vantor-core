export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface SwapQuoteRequest {
  chain: 'ethereum' | 'solana';
  fromToken: string;
  toToken: string;
  amount: string;        // human-readable
  slippageBps?: number;
  walletAddress: string;
}

export interface SwapQuoteResponse {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  rate: string;
  slippageBps: number;
  estimatedGas?: string;
  priceImpact?: string;
  quoteData: Record<string, unknown>;
}

export interface SwapExecuteRequest {
  walletId: string;
  quoteData: Record<string, unknown>;
  chain: 'ethereum' | 'solana';
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
}
