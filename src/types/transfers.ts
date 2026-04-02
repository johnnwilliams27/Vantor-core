import type { ChainType, TokenSymbol, TransferStatus } from './database';

export interface SendTransferInput {
  fromWalletId: string;
  toAddress: string;
  chain: ChainType;
  token: TokenSymbol;
  amount: string;
  memo?: string;
  invoiceId?: string;
}

export interface ScheduleTransferInput extends SendTransferInput {
  scheduledFor: string; // ISO timestamp
}

export interface TransferResult {
  transferId: string;
  txHash?: string;
  status: TransferStatus;
  error?: string;
}
