export type SnapshotTrigger = 'scheduled' | 'on_demand' | 'pre_decision' | 'pre_action';

export interface BankAccountPosition {
  accountId: string;
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
  totalFiatBaseUsd: number;
  totalStablecoinBaseUsd: number;
  totalDefiBaseUsd: number;
  positions: TreasuryPositions;
  fxRates: Record<string, number>;
}
