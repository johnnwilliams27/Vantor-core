import type {
  PoolLiquidity,
  SlippageEstimate,
  SlippageSeverity,
  TrancheRecommendation,
} from './interface';
import { SLIPPAGE_THRESHOLDS, SLIPPAGE_FACTORS } from './interface';

/**
 * Calculate estimated slippage for a given transaction size against pool liquidity.
 *
 * Formula: price_impact_bps = (transaction_size / pool_liquidity) * 10000 * slippage_factor
 *
 * slippage_factor: 0.5 for stablecoin pools, 1.0 for volatile pools
 */
export function calculateSlippage(
  transactionSizeUsd: number,
  poolLiquidity: PoolLiquidity,
): SlippageEstimate {
  const factor = SLIPPAGE_FACTORS[poolLiquidity.poolType] ?? 1.0;

  // Use available liquidity (not total) for more conservative estimate
  const effectiveLiquidity = poolLiquidity.availableLiquidityUsd || poolLiquidity.totalLiquidityUsd;

  const estimatedSlippageBps = effectiveLiquidity > 0
    ? (transactionSizeUsd / effectiveLiquidity) * 10000 * factor
    : 9999; // No liquidity → max slippage

  const estimatedSlippageCostUsd = (estimatedSlippageBps * transactionSizeUsd) / 10000;

  const severity = getSeverity(estimatedSlippageBps);

  const suggestedTranches = estimatedSlippageBps > SLIPPAGE_THRESHOLDS.TRANCHE_THRESHOLD
    ? calculateTranches(transactionSizeUsd, effectiveLiquidity, factor)
    : null;

  return {
    estimatedSlippageBps: Math.round(estimatedSlippageBps * 100) / 100,
    estimatedSlippageCostUsd: Math.round(estimatedSlippageCostUsd * 100) / 100,
    severity,
    transactionSizeUsd,
    poolLiquidity,
    suggestedTranches,
  };
}

export function getSeverity(bps: number): SlippageSeverity {
  if (bps < SLIPPAGE_THRESHOLDS.GREEN_MAX) return 'green';
  if (bps <= SLIPPAGE_THRESHOLDS.YELLOW_MAX) return 'yellow';
  return 'red';
}

/**
 * Calculate optimal tranche split where each tranche results in < TARGET_BPS slippage.
 *
 * Solve: (tranche_size / liquidity) * 10000 * factor = TARGET_BPS
 * → tranche_size = TARGET_BPS * liquidity / (10000 * factor)
 */
function calculateTranches(
  totalSizeUsd: number,
  liquidityUsd: number,
  factor: number,
): TrancheRecommendation {
  const targetBps = SLIPPAGE_THRESHOLDS.TARGET_BPS_PER_TRANCHE;
  const maxTrancheSize = (targetBps * liquidityUsd) / (10000 * factor);

  const numberOfTranches = Math.max(1, Math.ceil(totalSizeUsd / maxTrancheSize));
  const trancheSizeUsd = Math.round((totalSizeUsd / numberOfTranches) * 100) / 100;
  const estimatedBpsPerTranche = liquidityUsd > 0
    ? Math.round(((trancheSizeUsd / liquidityUsd) * 10000 * factor) * 100) / 100
    : 0;

  // Suggest 5-minute delay between tranches for liquidity to replenish
  const suggestedDelayMinutes = 5;

  return {
    numberOfTranches,
    trancheSizeUsd,
    estimatedBpsPerTranche,
    suggestedDelayMinutes,
  };
}
