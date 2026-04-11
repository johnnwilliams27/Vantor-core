import type { RecommendationAction } from '@/types/database';

export interface UpcomingObligation {
  id: string;
  source: 'erp_invoice' | 'manual';
  label: string;
  amountUsd: number;
  dueDate: string;
}

/**
 * Point-in-time treasury snapshot used by the rules engine, agent tools,
 * and the /api/treasury/overview endpoint.
 *
 * Bucketing convention matches `src/lib/treasury/holdings-category.ts`:
 *
 *   Cash bucket        = totalBankBalanceUsd + totalMmfPositionsUsd
 *   Stablecoin bucket  = totalCryptoBalanceUsd (wallet USDC/USDT only)
 *   DeFi bucket        = totalDefiPositionsUsd (non-MMF yield positions)
 *   Other bucket       = totalOtherYieldUsd    (unknown venue categories)
 *
 * `totalCryptoBalanceUsd` is intentionally NARROW — it represents idle
 * stablecoin wallet balances ONLY. It must not include yield positions.
 * Conflating them was the Phase A regression that produced the $11.3M /
 * $9.1M dashboard split; see the wiring-level regression test in
 * tests/treasury-rollup.test.ts.
 */
export interface TreasurySnapshot {
  /** Bank account balances only. USD-denominated. */
  totalBankBalanceUsd: number;

  /**
   * Idle stablecoin wallet balances (USDC, USDT) in self-custody wallets.
   * Does NOT include yield positions. See `totalDefiPositionsUsd` and
   * `totalMmfPositionsUsd` for deployed capital.
   */
  totalCryptoBalanceUsd: number;

  /**
   * Tokenized money market fund positions (BUIDL, OUSG, USYC, Spiko, etc.).
   * Cash equivalents in treasurer mental model — regulated fund shares
   * backed by short-term Treasuries. The Cash card rolls these up with
   * `totalBankBalanceUsd`.
   */
  totalMmfPositionsUsd: number;

  /**
   * DeFi protocol positions — Aave, Compound, Kamino, Morpho, Ondo USDY,
   * etc. Yield-generating positions that are NOT tokenized MMFs.
   */
  totalDefiPositionsUsd: number;

  /**
   * Yield positions whose venue classifies as 'other' (unknown protocol
   * ID, deprecated venue, etc.). Usually zero. Tracked explicitly so
   * the four bucket totals always sum cleanly without losing holdings.
   */
  totalOtherYieldUsd: number;

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
