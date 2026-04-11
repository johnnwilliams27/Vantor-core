import { describe, it, expect } from 'vitest';
import {
  getHoldingCardPlacement,
  type HoldingForCategorization,
} from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';

/**
 * Exhaustive tests for the holdings categorization function. The spec
 * requires that every combination of holding kind + venue category +
 * asset type resolves to a deterministic card placement.
 */

describe('getHoldingCardPlacement', () => {
  describe('bank balances always go to Cash', () => {
    it('returns "cash" for a bank balance', () => {
      const h: HoldingForCategorization = { kind: 'bank_balance' };
      expect(getHoldingCardPlacement(h)).toBe('cash');
    });
  });

  describe('wallet balances route by token type', () => {
    it('routes USDC wallet balance to Stablecoin card', () => {
      const h: HoldingForCategorization = { kind: 'wallet_balance', token: 'USDC' };
      expect(getHoldingCardPlacement(h)).toBe('stablecoin');
    });

    it('routes USDT wallet balance to Stablecoin card', () => {
      const h: HoldingForCategorization = { kind: 'wallet_balance', token: 'USDT' };
      expect(getHoldingCardPlacement(h)).toBe('stablecoin');
    });

    it('routes non-stablecoin wallet balance to Other', () => {
      // @ts-expect-error — intentionally passing a non-stable token to
      // verify the function's 'other' fallback behavior.
      const h: HoldingForCategorization = { kind: 'wallet_balance', token: 'ETH' };
      expect(getHoldingCardPlacement(h)).toBe('other');
    });
  });

  describe('yield positions route by venue category', () => {
    const defiLendingMarkets: YieldProtocolId[] = ['aave_v3', 'compound_v3', 'kamino'];
    const defiVaults: YieldProtocolId[] = [
      'morpho_steakhouse',
      'morpho_reservoir',
      'kamino_multiply',
      'ondo_usdy',
      'sky',
      'ethena',
    ];
    const tokenizedMmfs: YieldProtocolId[] = [
      'buidl',
      'ousg',
      'ustb',
      'benji',
      'usyc',
      'spiko_usd',
    ];

    defiLendingMarkets.forEach((protocol) => {
      it(`routes ${protocol} (defi_lending_market) to DeFi Positions`, () => {
        const h: HoldingForCategorization = { kind: 'yield_position', protocol };
        expect(getHoldingCardPlacement(h)).toBe('defi_positions');
      });
    });

    defiVaults.forEach((protocol) => {
      it(`routes ${protocol} (defi_vault) to DeFi Positions`, () => {
        const h: HoldingForCategorization = { kind: 'yield_position', protocol };
        expect(getHoldingCardPlacement(h)).toBe('defi_positions');
      });
    });

    tokenizedMmfs.forEach((protocol) => {
      it(`routes ${protocol} (tokenized_mmf) to Cash & Cash Equivalents`, () => {
        const h: HoldingForCategorization = { kind: 'yield_position', protocol };
        expect(getHoldingCardPlacement(h)).toBe('cash');
      });
    });

    it('routes unknown protocol to Other (graceful fallback)', () => {
      const h: HoldingForCategorization = {
        kind: 'yield_position',
        // @ts-expect-error — intentionally passing a protocol ID that isn't
        // in the venue registry to verify the fallback path.
        protocol: 'made_up_protocol_that_does_not_exist',
      };
      expect(getHoldingCardPlacement(h)).toBe('other');
    });
  });

  describe('critical invariant: no DeFi position is ever placed in Stablecoin card', () => {
    // This is the specific regression test for the pre-PR bug where
    // DeFi yield positions were grouped inside the Stablecoin card.
    // After the refactor, they must ALL route to defi_positions (never
    // stablecoin), regardless of the underlying token.
    const allDefiProtocols: YieldProtocolId[] = [
      'aave_v3',
      'compound_v3',
      'kamino',
      'morpho_steakhouse',
      'morpho_reservoir',
      'kamino_multiply',
      'ondo_usdy',
      'sky',
      'ethena',
    ];

    allDefiProtocols.forEach((protocol) => {
      it(`${protocol} yield position is NOT in Stablecoin card`, () => {
        const placement = getHoldingCardPlacement({ kind: 'yield_position', protocol });
        expect(placement).not.toBe('stablecoin');
        expect(placement).toBe('defi_positions');
      });
    });
  });

  describe('critical invariant: tokenized MMFs always go to Cash, never DeFi', () => {
    const allMmfs: YieldProtocolId[] = ['buidl', 'ousg', 'ustb', 'benji', 'usyc', 'spiko_usd'];

    allMmfs.forEach((protocol) => {
      it(`${protocol} always routes to cash (never defi_positions)`, () => {
        const placement = getHoldingCardPlacement({ kind: 'yield_position', protocol });
        expect(placement).toBe('cash');
        expect(placement).not.toBe('defi_positions');
      });
    });
  });
});
