import { describe, it, expect } from 'vitest';
import { computeSegmentationBuckets } from '@/lib/treasury/state/segmentation';
import type {
  BankAccountPosition,
  DefiPosition,
  WalletPosition,
} from '@/lib/treasury/state/types';

/**
 * Unit tests for the L3-leaf segmentation math.
 *
 * Confirms each position routes to the correct leaf and that the invariant
 * holds: sum of six new leaves === sum of three legacy aggregates ===
 * totalValueBaseUsd.
 */

function bank(
  balanceBaseUsd: number,
  currency: string = 'USD',
): BankAccountPosition {
  return {
    accountId: `ba_${currency}_${balanceBaseUsd}`,
    institutionName: 'Test Bank',
    accountName: `${currency} Operating`,
    last4: '0001',
    currency,
    balanceNative: balanceBaseUsd,
    balanceBaseUsd,
    balanceAsOf: null,
  };
}

function wallet(token: string, balanceBaseUsd: number): WalletPosition {
  return {
    walletId: `w_${token}`,
    chain: 'ethereum',
    token,
    balanceNative: balanceBaseUsd,
    balanceBaseUsd,
    lastUpdated: null,
  };
}

function yieldPos(protocol: string, currentValueBaseUsd: number): DefiPosition {
  return {
    positionId: `yp_${protocol}`,
    protocol,
    chain: 'ethereum',
    underlyingToken: 'USDC',
    depositedAmount: currentValueBaseUsd,
    currentValueBaseUsd,
    accruedYieldBaseUsd: 0,
    apySnapshot: null,
    lastRefreshedAt: null,
  };
}

describe('computeSegmentationBuckets', () => {
  it('empty input → all zero', () => {
    const b = computeSegmentationBuckets({ bankAccounts: [], wallets: [], defiPositions: [] });
    expect(b.totalValueBaseUsd).toBe(0);
    expect(b.totalBankBaseUsd).toBe(0);
    expect(b.totalStablecoinIdleBaseUsd).toBe(0);
    expect(b.totalMmfBaseUsd).toBe(0);
    expect(b.totalDefiVaultBaseUsd).toBe(0);
    expect(b.totalDefiLendingBaseUsd).toBe(0);
    expect(b.totalOtherBaseUsd).toBe(0);
  });

  it('multi-currency banks all roll into total_bank_base_usd', () => {
    const b = computeSegmentationBuckets({
      bankAccounts: [
        bank(100_000, 'USD'),
        bank(55_000, 'EUR'), // already FX-converted to USD base
        bank(30_000, 'GBP'),
      ],
      wallets: [],
      defiPositions: [],
    });
    expect(b.totalBankBaseUsd).toBe(185_000);
    expect(b.totalValueBaseUsd).toBe(185_000);
  });

  it('USDC/USDT wallet → stablecoin_idle; ETH wallet → other', () => {
    const b = computeSegmentationBuckets({
      bankAccounts: [],
      wallets: [
        wallet('USDC', 10_000),
        wallet('USDT', 5_000),
        wallet('ETH', 2_000),
      ],
      defiPositions: [],
    });
    expect(b.totalStablecoinIdleBaseUsd).toBe(15_000);
    expect(b.totalOtherBaseUsd).toBe(2_000);
    expect(b.totalValueBaseUsd).toBe(17_000);
  });

  it('yield positions route by venue category', () => {
    const b = computeSegmentationBuckets({
      bankAccounts: [],
      wallets: [],
      defiPositions: [
        yieldPos('buidl', 200_000),            // tokenized_mmf
        yieldPos('spiko_usd', 50_000),         // tokenized_mmf
        yieldPos('kamino_multiply', 75_000),   // defi_vault
        yieldPos('morpho_reservoir', 25_000),  // defi_vault
        yieldPos('aave_v3', 40_000),           // defi_lending
        yieldPos('compound_v3', 20_000),       // defi_lending
      ],
    });
    expect(b.totalMmfBaseUsd).toBe(250_000);
    expect(b.totalDefiVaultBaseUsd).toBe(100_000);
    expect(b.totalDefiLendingBaseUsd).toBe(60_000);
    expect(b.totalValueBaseUsd).toBe(410_000);
  });

  it('unknown yield venue → other (not silently dropped)', () => {
    const b = computeSegmentationBuckets({
      bankAccounts: [],
      wallets: [],
      defiPositions: [yieldPos('made_up_protocol', 9_999)],
    });
    expect(b.totalOtherBaseUsd).toBe(9_999);
    expect(b.totalValueBaseUsd).toBe(9_999);
  });

  it('invariant: new-leaf sum === legacy sum === totalValueBaseUsd', () => {
    const b = computeSegmentationBuckets({
      bankAccounts: [bank(100_000, 'USD'), bank(55_000, 'EUR')],
      wallets: [wallet('USDC', 10_000), wallet('USDT', 5_000), wallet('ETH', 2_000)],
      defiPositions: [
        yieldPos('buidl', 200_000),
        yieldPos('kamino_multiply', 50_000),
        yieldPos('aave_v3', 75_000),
      ],
    });

    const newLeafSum =
      b.totalBankBaseUsd +
      b.totalStablecoinIdleBaseUsd +
      b.totalMmfBaseUsd +
      b.totalDefiVaultBaseUsd +
      b.totalDefiLendingBaseUsd +
      b.totalOtherBaseUsd;

    const legacySum = b.totalFiatBaseUsd + b.totalStablecoinBaseUsd + b.totalDefiBaseUsd;

    expect(newLeafSum).toBe(b.totalValueBaseUsd);
    expect(legacySum).toBe(b.totalValueBaseUsd);
    expect(newLeafSum).toBe(legacySum);
  });

  it('integrated fixture: full realistic treasury', () => {
    // Bank: USD $100k, EUR €50k (already $55k USD base)
    // Wallets: $10k USDC, $5k USDT, $2k ETH
    // Yields: $200k BUIDL, $50k Kamino Multiply, $75k Aave V3
    const b = computeSegmentationBuckets({
      bankAccounts: [bank(100_000, 'USD'), bank(55_000, 'EUR')],
      wallets: [wallet('USDC', 10_000), wallet('USDT', 5_000), wallet('ETH', 2_000)],
      defiPositions: [
        yieldPos('buidl', 200_000),
        yieldPos('kamino_multiply', 50_000),
        yieldPos('aave_v3', 75_000),
      ],
    });

    expect(b.totalBankBaseUsd).toBe(155_000);
    expect(b.totalStablecoinIdleBaseUsd).toBe(15_000);
    expect(b.totalMmfBaseUsd).toBe(200_000);
    expect(b.totalDefiVaultBaseUsd).toBe(50_000);
    expect(b.totalDefiLendingBaseUsd).toBe(75_000);
    expect(b.totalOtherBaseUsd).toBe(2_000);
    expect(b.totalValueBaseUsd).toBe(497_000);

    // Cash & Equivalents rollup = 155k bank + 15k stable_idle = 170k
    expect(b.totalBankBaseUsd + b.totalStablecoinIdleBaseUsd).toBe(170_000);
    // Yield Positions rollup = 200k mmf + 50k vault + 75k lending = 325k
    expect(b.totalMmfBaseUsd + b.totalDefiVaultBaseUsd + b.totalDefiLendingBaseUsd).toBe(325_000);
  });
});
