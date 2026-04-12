import { describe, it, expect } from 'vitest';
import {
  getHoldingTaxonomy,
  getHoldingCardPlacement,
  type HoldingForCategorization,
  type HoldingTaxonomy,
} from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';

/**
 * Exhaustive tests for getHoldingTaxonomy — the L3-leaf classifier used by
 * the snapshot writer to populate treasury_state_snapshots aggregate columns.
 *
 * Vantor canonical taxonomy:
 *   Cash & Equivalents  → 'cash' | 'stablecoin'
 *   Yield Positions     → 'mmf' | 'defi_vault' | 'defi_lending'
 *   (catch-all)         → 'other'
 */

describe('getHoldingTaxonomy', () => {
  describe('bank balances always classify as cash', () => {
    it('returns "cash" for a bank balance', () => {
      const h: HoldingForCategorization = { kind: 'bank_balance' };
      expect(getHoldingTaxonomy(h)).toBe('cash');
    });
  });

  describe('wallet balances route by token type', () => {
    it('classifies USDC as stablecoin', () => {
      expect(getHoldingTaxonomy({ kind: 'wallet_balance', token: 'USDC' })).toBe('stablecoin');
    });
    it('classifies USDT as stablecoin', () => {
      expect(getHoldingTaxonomy({ kind: 'wallet_balance', token: 'USDT' })).toBe('stablecoin');
    });
    it('classifies non-stable tokens as other', () => {
      // @ts-expect-error — non-stable tokens fall through to 'other'
      expect(getHoldingTaxonomy({ kind: 'wallet_balance', token: 'ETH' })).toBe('other');
    });
  });

  describe('yield positions route by venue category', () => {
    const tokenizedMmfs: YieldProtocolId[] = [
      'buidl',
      'ousg',
      'ustb',
      'benji',
      'usyc',
      'spiko_usd',
    ];
    const defiVaults: YieldProtocolId[] = [
      'morpho_steakhouse',
      'morpho_reservoir',
      'kamino_multiply',
      'ondo_usdy',
      'sky',
      'ethena',
    ];
    const defiLending: YieldProtocolId[] = ['aave_v3', 'compound_v3', 'kamino'];

    tokenizedMmfs.forEach((protocol) => {
      it(`${protocol} classifies as mmf`, () => {
        expect(getHoldingTaxonomy({ kind: 'yield_position', protocol })).toBe('mmf');
      });
    });

    defiVaults.forEach((protocol) => {
      it(`${protocol} classifies as defi_vault`, () => {
        expect(getHoldingTaxonomy({ kind: 'yield_position', protocol })).toBe('defi_vault');
      });
    });

    defiLending.forEach((protocol) => {
      it(`${protocol} classifies as defi_lending`, () => {
        expect(getHoldingTaxonomy({ kind: 'yield_position', protocol })).toBe('defi_lending');
      });
    });

    it('unknown protocol falls through to other', () => {
      expect(
        getHoldingTaxonomy({
          kind: 'yield_position',
          // @ts-expect-error — intentionally unregistered protocol
          protocol: 'made_up_protocol',
        }),
      ).toBe('other');
    });
  });

  describe('legacy getHoldingCardPlacement stays consistent via delegation', () => {
    // After the refactor, the legacy 4-bucket model is derived from the
    // 6-leaf taxonomy. Confirm MMFs still collapse to 'cash' and DeFi
    // vault/lending both collapse to 'defi_positions'.

    it('mmf → cash (in card model)', () => {
      const h: HoldingForCategorization = { kind: 'yield_position', protocol: 'buidl' };
      expect(getHoldingTaxonomy(h)).toBe('mmf');
      expect(getHoldingCardPlacement(h)).toBe('cash');
    });

    it('defi_vault → defi_positions (in card model)', () => {
      const h: HoldingForCategorization = { kind: 'yield_position', protocol: 'kamino_multiply' };
      expect(getHoldingTaxonomy(h)).toBe('defi_vault');
      expect(getHoldingCardPlacement(h)).toBe('defi_positions');
    });

    it('defi_lending → defi_positions (in card model)', () => {
      const h: HoldingForCategorization = { kind: 'yield_position', protocol: 'aave_v3' };
      expect(getHoldingTaxonomy(h)).toBe('defi_lending');
      expect(getHoldingCardPlacement(h)).toBe('defi_positions');
    });

    it('bank → cash in both models', () => {
      const h: HoldingForCategorization = { kind: 'bank_balance' };
      expect(getHoldingTaxonomy(h)).toBe('cash');
      expect(getHoldingCardPlacement(h)).toBe('cash');
    });

    it('stablecoin token → stablecoin in both models', () => {
      const h: HoldingForCategorization = { kind: 'wallet_balance', token: 'USDC' };
      expect(getHoldingTaxonomy(h)).toBe('stablecoin');
      expect(getHoldingCardPlacement(h)).toBe('stablecoin');
    });
  });

  describe('exhaustive coverage: every HoldingTaxonomy value is reachable', () => {
    it('covers all six leaves', () => {
      const reached = new Set<HoldingTaxonomy>();
      reached.add(getHoldingTaxonomy({ kind: 'bank_balance' }));
      reached.add(getHoldingTaxonomy({ kind: 'wallet_balance', token: 'USDC' }));
      reached.add(getHoldingTaxonomy({ kind: 'yield_position', protocol: 'buidl' }));
      reached.add(getHoldingTaxonomy({ kind: 'yield_position', protocol: 'kamino_multiply' }));
      reached.add(getHoldingTaxonomy({ kind: 'yield_position', protocol: 'aave_v3' }));
      // @ts-expect-error — unregistered protocol → other
      reached.add(getHoldingTaxonomy({ kind: 'yield_position', protocol: 'unknown_x' }));

      expect(reached.has('cash')).toBe(true);
      expect(reached.has('stablecoin')).toBe(true);
      expect(reached.has('mmf')).toBe(true);
      expect(reached.has('defi_vault')).toBe(true);
      expect(reached.has('defi_lending')).toBe(true);
      expect(reached.has('other')).toBe(true);
      expect(reached.size).toBe(6);
    });
  });
});
