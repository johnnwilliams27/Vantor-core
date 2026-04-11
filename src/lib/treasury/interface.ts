import type { RecommendationAction, ChainType } from '@/types/database';
import type { VenueCategory } from '@/lib/yield/venues';

export interface UpcomingObligation {
  id: string;
  source: 'erp_invoice' | 'manual';
  label: string;
  amountUsd: number;
  dueDate: string;
}

/**
 * Venue type discriminator for unified position iteration.
 * Used by the insights engine to iterate across all positions
 * (bank accounts, wallets, yield positions) uniformly without
 * knowing which table they came from.
 */
export type VenueType = 'bank_account' | 'wallet' | 'yield_position';

export interface BankAccountSnapshot {
  id: string;
  institutionName: string;
  accountName: string;
  last4: string | null;
  /** ISO currency code (USD, EUR, GBP, ...). */
  currency: string;
  /**
   * Native-currency balance as reported by the bank.
   * Preserved alongside the USD conversion so detectors can reason
   * about currency exposure without reverse-engineering via FX rates.
   */
  currentBalanceNative: number;
  /** USD-converted balance using the most recent FX rate. */
  currentBalanceUsd: number;
  balanceAsOf: string | null;
}

export interface CryptoPositionSnapshot {
  walletId: string;
  chain: string;
  token: string;
  balance: number;
  usdValue: number;
}

/**
 * A single active yield position — a customer's deposit into a yield
 * venue (DeFi vault, DeFi lending market, tokenized MMF).
 */
export interface YieldPositionSnapshot {
  id: string;
  /** Protocol identifier matching src/lib/yield/venues registry. */
  protocol: string;
  chain: ChainType;
  underlyingToken: string;
  yieldToken: string | null;
  /** Venue category from the venues registry — drives detector logic. */
  venueCategory: VenueCategory | null;
  /** Amount of underlying token originally deposited. */
  depositedAmount: number;
  /** Balance of the yield-bearing token held. */
  yieldTokenBalance: number;
  /** Current USD value of the position. */
  currentValueUsd: number;
  /** Realized + unrealized yield in USD. */
  accruedYieldUsd: number;
  /** APY snapshot at last refresh (decimal, e.g. 0.0485). */
  apySnapshot: number | null;
  lastRefreshedAt: string | null;
}

export interface TreasurySnapshot {
  totalBankBalanceUsd: number;
  totalCryptoBalanceUsd: number;
  /** Sum of current_value_usd across all active yield positions. */
  totalYieldBalanceUsd: number;
  bankAccounts: BankAccountSnapshot[];
  cryptoPositions: CryptoPositionSnapshot[];
  /** Active yield positions — empty array if the customer has none. */
  yieldPositions: YieldPositionSnapshot[];
}

export interface RulesEngineResult {
  snapshot: TreasurySnapshot;
  obligationsInWindow: UpcomingObligation[];
  totalObligationsUsd: number;
  safetyBufferTargetUsd: number;
  surplusUsd: number;
  action: RecommendationAction;
  recommendedAmountUsd: number | null;
  requiresApproval: boolean;
  targetBankAccountId: string | null;
  targetStablecoinToken: string;
  targetChain: string;
  lookaheadDays: number;
}

export interface RecommendationInput extends RulesEngineResult {
  ruleLabel: string;
  approvalThresholdUsd: number;
}
