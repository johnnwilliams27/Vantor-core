/**
 * Treasury segmentation aggregates.
 *
 * Pure, deterministic rollup of parsed positions into the canonical six L3
 * leaves defined in `src/lib/treasury/holdings-category.ts`. Extracted out
 * of the snapshot writer so it can be tested directly without mocking
 * Supabase. The writer calls this and persists the result.
 *
 * The legacy aggregates (fiat / stablecoin / defi) are returned alongside
 * the new leaves for dual-write through the Phase C-1.5 migration window.
 */

import { getHoldingTaxonomy } from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';
import type { BankAccountPosition, DefiPosition, WalletPosition } from './types';

export interface SegmentationBuckets {
  // New L3 leaves (Phase C-1.5a)
  totalBankBaseUsd: number;
  totalStablecoinIdleBaseUsd: number;
  totalMmfBaseUsd: number;
  totalDefiVaultBaseUsd: number;
  totalDefiLendingBaseUsd: number;
  totalOtherBaseUsd: number;
  // Legacy aggregates (dual-write)
  totalFiatBaseUsd: number;
  totalStablecoinBaseUsd: number;
  totalDefiBaseUsd: number;
  // Grand total — sum of new leaves (equivalent to sum of legacy)
  totalValueBaseUsd: number;
}

export interface SegmentationInput {
  bankAccounts: BankAccountPosition[];
  wallets: WalletPosition[];
  defiPositions: DefiPosition[];
}

/**
 * Aggregate positions into the canonical treasury buckets.
 *
 * Classification rules:
 *   - Every bank balance → `bank`
 *   - Wallet balance with USDC/USDT token → `stablecoin_idle`, else → `other`
 *   - Yield position routes by `venue.category`:
 *       `tokenized_mmf`       → `mmf`
 *       `defi_vault`          → `defi_vault`
 *       `defi_lending_market` → `defi_lending`
 *       unknown/missing       → `other`
 *
 * Invariant: sum of the six L3 leaves equals sum of the three legacy
 * aggregates equals `totalValueBaseUsd`. Callers can assert this to catch
 * taxonomy drift (e.g. a new venue category added to the registry but not
 * to `getHoldingTaxonomy`).
 */
export function computeSegmentationBuckets(input: SegmentationInput): SegmentationBuckets {
  let totalBankBaseUsd = 0;
  let totalStablecoinIdleBaseUsd = 0;
  let totalMmfBaseUsd = 0;
  let totalDefiVaultBaseUsd = 0;
  let totalDefiLendingBaseUsd = 0;
  let totalOtherBaseUsd = 0;

  for (const b of input.bankAccounts) {
    totalBankBaseUsd += b.balanceBaseUsd;
  }
  for (const w of input.wallets) {
    const tax = getHoldingTaxonomy({
      kind: 'wallet_balance',
      token: w.token as TokenSymbol,
    });
    if (tax === 'stablecoin') totalStablecoinIdleBaseUsd += w.balanceBaseUsd;
    else totalOtherBaseUsd += w.balanceBaseUsd;
  }
  for (const p of input.defiPositions) {
    const tax = getHoldingTaxonomy({
      kind: 'yield_position',
      protocol: p.protocol as YieldProtocolId,
    });
    if (tax === 'mmf') totalMmfBaseUsd += p.currentValueBaseUsd;
    else if (tax === 'defi_vault') totalDefiVaultBaseUsd += p.currentValueBaseUsd;
    else if (tax === 'defi_lending') totalDefiLendingBaseUsd += p.currentValueBaseUsd;
    else totalOtherBaseUsd += p.currentValueBaseUsd;
  }

  const totalFiatBaseUsd = input.bankAccounts.reduce((a, b) => a + b.balanceBaseUsd, 0);
  const totalStablecoinBaseUsd = input.wallets.reduce((a, b) => a + b.balanceBaseUsd, 0);
  const totalDefiBaseUsd = input.defiPositions.reduce(
    (a, b) => a + b.currentValueBaseUsd,
    0,
  );

  const totalValueBaseUsd =
    totalBankBaseUsd +
    totalStablecoinIdleBaseUsd +
    totalMmfBaseUsd +
    totalDefiVaultBaseUsd +
    totalDefiLendingBaseUsd +
    totalOtherBaseUsd;

  return {
    totalBankBaseUsd,
    totalStablecoinIdleBaseUsd,
    totalMmfBaseUsd,
    totalDefiVaultBaseUsd,
    totalDefiLendingBaseUsd,
    totalOtherBaseUsd,
    totalFiatBaseUsd,
    totalStablecoinBaseUsd,
    totalDefiBaseUsd,
    totalValueBaseUsd,
  };
}
