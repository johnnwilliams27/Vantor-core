import type { ChainType, TokenSymbol, PaymentStatus } from './database';

export interface SendPaymentInput {
  fromWalletId: string;
  toAddress: string;
  chain: ChainType;
  token: TokenSymbol;
  amount: string;
  memo?: string;
  invoiceId?: string;
}

export interface SchedulePaymentInput extends SendPaymentInput {
  scheduledFor: string; // ISO timestamp
}

export interface PaymentResult {
  paymentId: string;
  txHash?: string;
  status: PaymentStatus;
  error?: string;
}
