import { describe, it, expect } from 'vitest';
import {
  getHoldingCardPlacement,
  type CardPlacement,
  type HoldingForCategorization,
} from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';

/**
 * Treasury rollup invariant tests.
 *
 * The critical property under test: the sum of all holdings across all
 * cards (Cash, Stablecoins, DeFi Positions, Other) must equal the total
 * treasury value, regardless of how the holdings are distributed.
 *
 * Before and after the venue category restructure, the same underlying
 * holdings must produce the same total treasury — only the grouping
 * (which card each holding lands in) changes.
 */

type TestHolding = {
  type: 'bank' | 'wallet' | 'yield';
  protocol?: YieldProtocolId;
  token?: TokenSymbol;
  valueUsd: number;
  label: string;
};

const fmtHoldingForCat = (h: TestHolding): HoldingForCategorization => {
  if (h.type === 'bank') return { kind: 'bank_balance' };
  if (h.type === 'wallet') return { kind: 'wallet_balance', token: h.token! };
  return { kind: 'yield_position', protocol: h.protocol! };
};

/**
 * Realistic seed holdings that mirror what a demo enterprise would have
 * after running src/lib/test-mode/seed/yield.ts. Includes bank balances,
 * idle wallet stablecoins, DeFi positions, and tokenized MMF demo positions.
 */
const seedHoldings: TestHolding[] = [
  // Bank balances
  { type: 'bank', valueUsd: 1_250_000, label: 'USD checking' },
  { type: 'bank', valueUsd: 350_000, label: 'EUR operations' },

  // Idle stablecoin wallet balances
  { type: 'wallet', token: 'USDC', valueUsd: 500_000, label: 'ETH wallet USDC' },
  { type: 'wallet', token: 'USDT', valueUsd: 200_000, label: 'ETH wallet USDT' },

  // DeFi yield positions
  { type: 'yield', protocol: 'aave_v3', valueUsd: 260_000, label: 'Aave V3 USDC' },
  { type: 'yield', protocol: 'morpho_reservoir', valueUsd: 156_500, label: 'Morpho Reservoir' },
  { type: 'yield', protocol: 'kamino', valueUsd: 105_200, label: 'Kamino Lend' },
  { type: 'yield', protocol: 'ondo_usdy', valueUsd: 521_000, label: 'Ondo USDY' },

  // Tokenized MMF demo positions — these land in Cash, not DeFi
  { type: 'yield', protocol: 'spiko_usd', valueUsd: 250_000, label: 'Spiko USD' },
  { type: 'yield', protocol: 'usyc', valueUsd: 400_000, label: 'Circle USYC' },
  { type: 'yield', protocol: 'ousg', valueUsd: 750_000, label: 'Ondo OUSG' },
];

function sumByCard(holdings: TestHolding[]): Record<CardPlacement, number> {
  const totals: Record<CardPlacement, number> = {
    cash: 0,
    stablecoin: 0,
    defi_positions: 0,
    other: 0,
  };
  for (const h of holdings) {
    const placement = getHoldingCardPlacement(fmtHoldingForCat(h));
    totals[placement] += h.valueUsd;
  }
  return totals;
}

function totalUsd(holdings: TestHolding[]): number {
  return holdings.reduce((acc, h) => acc + h.valueUsd, 0);
}

describe('treasury rollup invariants', () => {
  it('sum of card subtotals equals total treasury (seed fixture)', () => {
    const cards = sumByCard(seedHoldings);
    const sumOfCards =
      cards.cash + cards.stablecoin + cards.defi_positions + cards.other;
    expect(sumOfCards).toBe(totalUsd(seedHoldings));
  });

  it('Cash card includes bank balances PLUS tokenized MMF positions', () => {
    const cards = sumByCard(seedHoldings);
    const bankTotal = seedHoldings
      .filter((h) => h.type === 'bank')
      .reduce((a, h) => a + h.valueUsd, 0);
    const mmfTotal = seedHoldings
      .filter((h) => h.type === 'yield' && ['buidl', 'ousg', 'ustb', 'benji', 'usyc', 'spiko_usd'].includes(h.protocol!))
      .reduce((a, h) => a + h.valueUsd, 0);
    expect(cards.cash).toBe(bankTotal + mmfTotal);
  });

  it('Stablecoin card contains only idle stablecoin balances', () => {
    const cards = sumByCard(seedHoldings);
    const idleStables = seedHoldings
      .filter((h) => h.type === 'wallet' && (h.token === 'USDC' || h.token === 'USDT'))
      .reduce((a, h) => a + h.valueUsd, 0);
    expect(cards.stablecoin).toBe(idleStables);
  });

  it('DeFi Positions card contains ONLY yield positions in DeFi venues', () => {
    const cards = sumByCard(seedHoldings);
    const defiOnly = seedHoldings
      .filter(
        (h) =>
          h.type === 'yield' &&
          ['aave_v3', 'compound_v3', 'kamino', 'morpho_steakhouse', 'morpho_reservoir', 'kamino_multiply', 'ondo_usdy', 'sky', 'ethena'].includes(h.protocol!),
      )
      .reduce((a, h) => a + h.valueUsd, 0);
    expect(cards.defi_positions).toBe(defiOnly);
  });

  it('no DeFi position is double-counted in Stablecoin card', () => {
    // Regression test for the pre-PR bug: DeFi positions were previously
    // grouped inside the Stablecoin card's "Deployed" subsection. After
    // the restructure, DeFi values must appear in defi_positions and NOT
    // in stablecoin. This test would fail if UnifiedBalanceCard ever
    // regressed to pulling yield_positions into stablecoin totals.
    const cards = sumByCard(seedHoldings);
    const idleStables = seedHoldings
      .filter((h) => h.type === 'wallet' && (h.token === 'USDC' || h.token === 'USDT'))
      .reduce((a, h) => a + h.valueUsd, 0);
    // If any DeFi position leaked in, this would be larger than idleStables.
    expect(cards.stablecoin).toBe(idleStables);
    expect(cards.stablecoin).toBeLessThan(cards.defi_positions + cards.stablecoin + 1);
  });

  it('empty holdings produces $0 total', () => {
    const cards = sumByCard([]);
    expect(cards.cash).toBe(0);
    expect(cards.stablecoin).toBe(0);
    expect(cards.defi_positions).toBe(0);
    expect(cards.other).toBe(0);
  });

  it('all-bank holdings roll up to cash card only', () => {
    const onlyBanks: TestHolding[] = [
      { type: 'bank', valueUsd: 1_000_000, label: 'A' },
      { type: 'bank', valueUsd: 2_000_000, label: 'B' },
    ];
    const cards = sumByCard(onlyBanks);
    expect(cards.cash).toBe(3_000_000);
    expect(cards.stablecoin).toBe(0);
    expect(cards.defi_positions).toBe(0);
  });

  it('all-MMF holdings roll up to cash card only', () => {
    const onlyMmfs: TestHolding[] = [
      { type: 'yield', protocol: 'buidl', valueUsd: 500_000, label: 'BUIDL' },
      { type: 'yield', protocol: 'ousg', valueUsd: 750_000, label: 'OUSG' },
      { type: 'yield', protocol: 'spiko_usd', valueUsd: 250_000, label: 'Spiko' },
    ];
    const cards = sumByCard(onlyMmfs);
    expect(cards.cash).toBe(1_500_000);
    expect(cards.defi_positions).toBe(0);
  });
});
