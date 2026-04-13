import { describe, it, expect } from 'vitest';
import {
  obligationAmountToUsdPessimistic,
  DEFAULT_PESSIMISTIC_BPS,
} from '@/lib/fx/obligation-fx';
import { getFxRate } from '@/lib/fx/rates';

describe('obligationAmountToUsdPessimistic', () => {
  it('USD passes through unchanged', () => {
    expect(obligationAmountToUsdPessimistic(1000, 'USD')).toBe(1000);
  });

  it('stablecoin currencies (USDC/USDT) treated as 1:1 USD, no haircut', () => {
    expect(obligationAmountToUsdPessimistic(5000, 'USDC')).toBe(5000);
    expect(obligationAmountToUsdPessimistic(5000, 'USDT')).toBe(5000);
  });

  it('unsupported currency falls through as 1:1 (no FX panic)', () => {
    expect(obligationAmountToUsdPessimistic(100, 'JPY')).toBe(100);
  });

  it('EUR obligation inflates UP by default 5% vs live rate', () => {
    const live = getFxRate('EUR', 'USD');
    const amount = 1000;
    const expected = amount * live * 1.05;
    expect(obligationAmountToUsdPessimistic(amount, 'EUR')).toBeCloseTo(expected, 4);
  });

  it('pessimistic result > live-rate conversion (conservative UP, not DOWN)', () => {
    const live = getFxRate('GBP', 'USD');
    const pessimistic = obligationAmountToUsdPessimistic(1000, 'GBP');
    expect(pessimistic).toBeGreaterThan(1000 * live);
  });

  it('bpsShift is configurable', () => {
    const live = getFxRate('EUR', 'USD');
    const shiftedBy200 = obligationAmountToUsdPessimistic(1000, 'EUR', 200);
    expect(shiftedBy200).toBeCloseTo(1000 * live * 1.02, 4);
  });

  it('DEFAULT_PESSIMISTIC_BPS is 500 (= 5%)', () => {
    expect(DEFAULT_PESSIMISTIC_BPS).toBe(500);
  });
});
