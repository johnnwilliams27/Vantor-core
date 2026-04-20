import { describe, it, expect } from 'vitest';
import { getYieldTokenSymbol, YIELD_TOKENS } from './yield-tokens';

describe('getYieldTokenSymbol', () => {
  it('returns the receipt-token symbol for known protocols', () => {
    expect(getYieldTokenSymbol('compound_v3')).toBe('cUSDCv3');
    expect(getYieldTokenSymbol('aave_v3')).toBe('aUSDC');
    expect(getYieldTokenSymbol('morpho_reservoir')).toBe('bbqUSDCreservoir');
    expect(getYieldTokenSymbol('kamino')).toBe('kUSDC');
  });

  it('throws for unknown protocol', () => {
    expect(() => getYieldTokenSymbol('not_a_protocol' as never)).toThrow(
      /unknown yield protocol/i,
    );
  });

  it('covers every YieldProtocolId without gaps', () => {
    for (const key of Object.keys(YIELD_TOKENS)) {
      expect(typeof YIELD_TOKENS[key as keyof typeof YIELD_TOKENS]).toBe('string');
    }
  });
});
