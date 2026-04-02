import type { ChainType, TokenSymbol } from './database';

export type ScheduledOperationType = 'swap' | 'bridge' | 'ramp';

export type ScheduledOperationStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_authorization'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ScheduledOperation {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  type: ScheduledOperationType;
  status: ScheduledOperationStatus;
  scheduled_for: string;
  params: SwapParams | BridgeParams | RampParams;
  initial_quote: Record<string, unknown>;
  execution_quote: Record<string, unknown> | null;
  deviation_bps: number | null;
  tolerance_bps: number;
  executed_at: string | null;
  expires_at: string | null;
  tx_hash: string | null;
  error_message: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface SwapParams {
  walletId: string;
  chain: ChainType;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  amount: string;
  slippageBps?: number;
  walletAddress: string;
}

export interface BridgeParams {
  fromWalletId: string;
  toWalletId: string;
  token: TokenSymbol;
  amount: string;
  fromChain: ChainType;
  toChain: ChainType;
  walletAddress: string;
}

export interface RampParams {
  direction: 'onramp' | 'offramp';
  cryptoToken: TokenSymbol;
  fiatCurrency: string;
  cryptoAmount: number;
  fiatAmount?: number;
  bankAccountId: string;
  walletId?: string;
}

export interface ScheduledMetadata {
  original_rate: string;
  executed_rate: string;
  deviation_bps: number;
  scheduled_for: string;
}
