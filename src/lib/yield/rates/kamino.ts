import type { RateFetcher, RateResult } from './types';
import { getLlamaPool, llamaApyToDecimal } from './llama';

/**
 * Kamino on Solana.
 *
 * History: we previously hit the native Kamino API directly at
 *   https://api.kamino.finance/kamino-market/<market>/reserves
 * but that endpoint has returned 404 for an extended period
 * (verified 2026-04-11). Rather than maintain a broken primary source,
 * we now pull both APY and TVL from DefiLlama.
 *
 * DefiLlama pool IDs are stable but can rotate when Llama rebalances
 * their dataset — if the cron starts returning null TVL/APY for
 * Kamino, re-verify these against `yields.llama.fi/pools` (project:
 * kamino-lend, chain: Solana, symbol: USDC/USDT).
 */

const KAMINO_USDC_LLAMA_POOL = 'd2141a59-c199-4be7-8d4b-c8223954836b';
const KAMINO_USDT_LLAMA_POOL = '546b3c0c-138d-4190-b46b-efa1765f1dd3';

// Note: Kamino Multiply is intentionally NOT emitted here. Real leveraged
// APY depends on the borrow-side rate of the specific Multiply vault and
// looping fees — it cannot be derived from the lend APY by a constant
// multiplier. DefiLlama does not aggregate a `kamino-multiply` project
// (only `kamino-lend` and `kamino-liquidity`), and Kamino's own reserves
// endpoint has been 404 for an extended period. Until a real source is
// wired, the venue stays gated as coming_soon.

async function fetchKaminoRow(
  poolId: string,
): Promise<{ supplyAPY: number; tvlUsd: number | null }> {
  const pool = await getLlamaPool(poolId);
  if (!pool) return { supplyAPY: 0, tvlUsd: null };
  return {
    supplyAPY: llamaApyToDecimal(pool.apy),
    tvlUsd: pool.tvlUsd,
  };
}

export const kaminoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const [usdc, usdt] = await Promise.all([
      fetchKaminoRow(KAMINO_USDC_LLAMA_POOL),
      fetchKaminoRow(KAMINO_USDT_LLAMA_POOL),
    ]);

    return [
      { protocol: 'kamino', token: 'USDC', chain: 'solana', supplyAPY: usdc.supplyAPY, rewardAPY: 0, tvlUsd: usdc.tvlUsd },
      { protocol: 'kamino', token: 'USDT', chain: 'solana', supplyAPY: usdt.supplyAPY, rewardAPY: 0, tvlUsd: usdt.tvlUsd },
    ];
  },
};
