import type { ChainType, TokenSymbol } from '@/types/database';

export type YieldProtocolId =
  | 'aave_v3'
  | 'compound_v3'
  | 'morpho'
  | 'morpho_steakhouse'
  | 'kamino'
  | 'kamino_multiply'
  | 'ondo'
  | 'sky'
  | 'ethena'
  | 'drift';
export type YieldRiskLevel = 'low' | 'medium' | 'high';

export interface RiskFactors {
  smartContract: 1 | 2 | 3;   // 1=audited+battletested, 2=audited, 3=unaudited
  counterparty: 1 | 2 | 3;    // 1=fully decentralized, 2=partial custodian, 3=centralized custodian
  liquidity: 1 | 2 | 3;       // 1=deep liquidity, 2=moderate, 3=thin/lock-up
  regulatory: 1 | 2 | 3;      // 1=regulated/compliant, 2=partially, 3=unregulated
}

export const RISK_FACTOR_LABELS: Record<keyof RiskFactors, string> = {
  smartContract: 'Smart Contract',
  counterparty: 'Counterparty',
  liquidity: 'Liquidity',
  regulatory: 'Regulatory',
};

export const RISK_SCORE_LABELS: Record<number, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

export interface YieldProtocolInfo {
  id: YieldProtocolId;
  name: string;
  chain: ChainType;
  supportedTokens: TokenSymbol[];
  description: string;
  riskLevel: YieldRiskLevel;
  riskFactors: RiskFactors;
  kycRequired: boolean;
}

export interface YieldRate {
  protocol: YieldProtocolId;
  token: TokenSymbol;
  chain: ChainType;
  supplyAPY: number;   // e.g. 0.0485 = 4.85%
  rewardAPY: number;   // additional reward token APY
  totalAPY: number;    // supplyAPY + rewardAPY
  fetchedAt: string;
}

export interface DepositParams {
  token: TokenSymbol;
  amount: string;
  walletAddress: string;
  chain: ChainType;
  vaultAddress?: string;
}

export interface DepositResult {
  txHash: string | null;
  providerRef?: string;
  yieldToken: string;
  yieldTokenAmount: string;
  tokensReceived: number;
  estimatedAPY: number;
}

export interface WithdrawParams {
  token: TokenSymbol;
  amount: string;
  walletAddress: string;
  chain: ChainType;
  yieldToken?: string;
  vaultAddress?: string;
}

export interface WithdrawResult {
  txHash: string | null;
  providerRef?: string;
  receivedAmount: string;
  tokensRedeemed: number;
  fee?: string;
}

export interface PositionInfo {
  protocol: YieldProtocolId;
  chain: ChainType;
  underlyingToken: TokenSymbol;
  yieldToken: string;
  depositedAmount: string;
  currentValueUsd: number;
  accruedYieldUsd: number;
  currentAPY: number;
  metadata: Record<string, unknown>;
}

export interface OnChainValue {
  currentValueUsd: number;
  yieldTokenBalance: number;
}

export interface IYieldProtocol {
  getInfo(): YieldProtocolInfo;
  getAPY(token: TokenSymbol): Promise<YieldRate>;
  getPosition(walletAddress: string, token: TokenSymbol): Promise<PositionInfo | null>;
  getOnChainValue(walletAddress: string, token: TokenSymbol, yieldToken: string): Promise<OnChainValue>;
  deposit(params: DepositParams): Promise<DepositResult>;
  withdraw(params: WithdrawParams): Promise<WithdrawResult>;
}
