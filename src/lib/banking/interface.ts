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
  /** ISO timestamp */
  expiresAt: string;
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

export interface IBankingAdapter {
  getRampQuote(params: RampQuoteParams): Promise<RampQuote>;
  executeRamp(params: RampExecuteParams): Promise<RampResult>;
}
