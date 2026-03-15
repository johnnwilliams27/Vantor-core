import type { ChainType, TokenSymbol } from '@/types/database';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type SlippageSeverity = 'green' | 'yellow' | 'red';

export interface PoolLiquidity {
  protocol: YieldProtocolId;
  chain: ChainType;
  token: TokenSymbol;
  totalLiquidityUsd: number;
  availableLiquidityUsd: number;
  utilizationRate: number; // 0-1
  poolType: 'stablecoin' | 'volatile';
  metadata: Record<string, unknown>;
  fetchedAt: string;
}

export interface SlippageEstimate {
  estimatedSlippageBps: number;
  estimatedSlippageCostUsd: number;
  severity: SlippageSeverity;
  transactionSizeUsd: number;
  poolLiquidity: PoolLiquidity;
  suggestedTranches: TrancheRecommendation | null;
}

export interface TrancheRecommendation {
  numberOfTranches: number;
  trancheSizeUsd: number;
  estimatedBpsPerTranche: number;
  suggestedDelayMinutes: number;
}

export interface SlippageLogEntry {
  estimated_slippage_bps: number;
  actual_slippage_bps: number | null;
  pool_liquidity_usd: number;
  transaction_size_usd: number;
  protocol: YieldProtocolId;
  severity: SlippageSeverity;
  tranches_suggested: number | null;
  user_acknowledged: boolean;
}

export interface ILiquidityProvider {
  getPoolLiquidity(
    protocol: YieldProtocolId,
    chain: ChainType,
    token: TokenSymbol,
  ): Promise<PoolLiquidity>;
}

// Slippage thresholds in basis points
export const SLIPPAGE_THRESHOLDS = {
  GREEN_MAX: 5,
  YELLOW_MAX: 20,
  TRANCHE_THRESHOLD: 10,
  TARGET_BPS_PER_TRANCHE: 5,
} as const;

// Slippage factor by pool type
export const SLIPPAGE_FACTORS: Record<string, number> = {
  stablecoin: 0.5,
  volatile: 1.0,
};
