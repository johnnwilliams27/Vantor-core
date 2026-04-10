/**
 * Average cost basis accounting for yield positions.
 *
 * The blockchain is the source of truth for current value.
 * Our DB is the source of truth for cost basis (what was put in net of withdrawals).
 * Yield = current value - cost basis.
 */

export interface CostBasisUpdate {
  newDepositedAmount: number;
  newYieldTokenBalance: number;
}

/**
 * Adjust cost basis after a deposit.
 * Simply adds the new deposit to existing cost basis.
 */
export function applyDeposit(
  currentDeposited: number,
  currentTokenBalance: number,
  depositAmount: number,
  tokensReceived: number,
): CostBasisUpdate {
  return {
    newDepositedAmount: currentDeposited + depositAmount,
    newYieldTokenBalance: currentTokenBalance + tokensReceived,
  };
}

/**
 * Adjust cost basis after a partial or full withdrawal.
 * Uses average cost basis: reduces deposited_amount proportionally
 * to the fraction of total value being withdrawn.
 *
 * Example: position worth $160k (deposited $150k, yield $10k), withdraw $30k
 *   withdrawFraction = 30000 / 160000 = 0.1875
 *   newDeposited = 150000 * (1 - 0.1875) = 121875
 *   realizedYield = 30000 - (150000 * 0.1875) = 30000 - 28125 = 1875
 */
export function applyWithdrawal(
  currentDeposited: number,
  currentTokenBalance: number,
  currentValueUsd: number,
  withdrawAmountUsd: number,
  tokensRedeemed: number,
): CostBasisUpdate & { realizedYield: number; isFullWithdrawal: boolean } {
  const isFullWithdrawal = tokensRedeemed >= currentTokenBalance || withdrawAmountUsd >= currentValueUsd;

  if (isFullWithdrawal) {
    const realizedYield = currentValueUsd - currentDeposited;
    return {
      newDepositedAmount: 0,
      newYieldTokenBalance: 0,
      realizedYield: Math.max(0, realizedYield),
      isFullWithdrawal: true,
    };
  }

  const withdrawFraction = withdrawAmountUsd / currentValueUsd;
  const costBasisReduction = currentDeposited * withdrawFraction;
  const realizedYield = withdrawAmountUsd - costBasisReduction;

  return {
    newDepositedAmount: currentDeposited * (1 - withdrawFraction),
    newYieldTokenBalance: currentTokenBalance - tokensRedeemed,
    realizedYield: Math.max(0, realizedYield),
    isFullWithdrawal: false,
  };
}

/**
 * Compute accrued yield from current on-chain value and cost basis.
 * Called during position refresh.
 */
export function computeAccruedYield(
  currentValueUsd: number,
  depositedAmount: number,
): number {
  return Math.max(0, currentValueUsd - depositedAmount);
}
