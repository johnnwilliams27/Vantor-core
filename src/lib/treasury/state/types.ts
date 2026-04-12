export type SnapshotTrigger = 'scheduled' | 'on_demand' | 'pre_decision' | 'pre_action';

export interface BankAccountPosition {
  accountId: string;
  /**
   * Display label for the issuing institution (e.g. "Chase", "Mercury").
   * Denormalized into the snapshot so UI consumers don't need a second
   * lookup against bank_accounts after reading a cached snapshot.
   */
  institutionName: string;
  /**
   * User-facing account nickname from bank_accounts.account_name.
   */
  accountName: string;
  /**
   * Last four digits of the account number. Null when unknown (legacy
   * rows or accounts that never exposed full digits).
   */
  last4: string | null;
  currency: string;
  balanceNative: number;
  balanceBaseUsd: number;
  balanceAsOf: string | null;
}

export interface WalletPosition {
  walletId: string;
  chain: string;
  token: string;
  balanceNative: number;
  balanceBaseUsd: number;
  lastUpdated: string | null;
}

export interface DefiPosition {
  positionId: string;
  protocol: string;
  chain: string;
  underlyingToken: string;
  depositedAmount: number;
  currentValueBaseUsd: number;
  accruedYieldBaseUsd: number;
  apySnapshot: number | null;
  lastRefreshedAt: string | null;
}

export interface PendingTransfer {
  id: string;
  kind: 'transfer' | 'bridge_transfer' | 'fiat_payment' | 'fiat_transaction' | 'yield_transaction';
  amount: number;
  asset: string;
  fromVenue: string | null;
  toVenue: string | null;
  expectedSettleAt: string | null;
}

export interface TreasuryPositions {
  bankAccounts: BankAccountPosition[];
  wallets: WalletPosition[];
  defiPositions: DefiPosition[];
  pendingTransfers: PendingTransfer[];
}

export interface TreasuryStateSnapshot {
  id: string;
  enterpriseId: string;
  takenAt: string;
  takenBy: string | null;
  trigger: SnapshotTrigger;
  baseCurrency: string;
  totalValueBaseUsd: number;
  /** @deprecated — replaced by totalBankBaseUsd. Dual-written through C-1.5a migration window. */
  totalFiatBaseUsd: number;
  /** @deprecated — replaced by totalStablecoinIdleBaseUsd + a slice of totalOtherBaseUsd. Dual-written through C-1.5a migration window. */
  totalStablecoinBaseUsd: number;
  /** @deprecated — replaced by totalMmfBaseUsd + totalDefiVaultBaseUsd + totalDefiLendingBaseUsd. Dual-written through C-1.5a migration window. */
  totalDefiBaseUsd: number;
  // Canonical L3 leaves — Phase C-1.5a. See holdings-category.ts taxonomy.
  totalBankBaseUsd: number;
  totalStablecoinIdleBaseUsd: number;
  totalMmfBaseUsd: number;
  totalDefiVaultBaseUsd: number;
  totalDefiLendingBaseUsd: number;
  totalOtherBaseUsd: number;
  positions: TreasuryPositions;
  fxRates: Record<string, number>;
}
