import type { RecommendationAction } from '@/types/database';

export interface UpcomingObligation {
  id: string;
  source: 'erp_invoice' | 'manual';
  label: string;
  amountUsd: number;
  dueDate: string;
}

export interface TreasurySnapshot {
  totalBankBalanceUsd: number;
  totalCryptoBalanceUsd: number;
  bankAccounts: Array<{
    id: string;
    institutionName: string;
    accountName: string;
    last4: string | null;
    currency: string;
    currentBalanceUsd: number;
    balanceAsOf: string | null;
  }>;
  cryptoPositions: Array<{
    walletId: string;
    chain: string;
    token: string;
    balance: number;
    usdValue: number;
  }>;
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
