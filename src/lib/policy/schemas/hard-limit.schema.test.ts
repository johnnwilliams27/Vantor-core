import { describe, it, expect } from 'vitest';
import { hardLimitSchema } from './hard-limit.schema';

describe('hardLimitSchema', () => {
  const baseValid = {
    id: 'hl-1',
    limit_type: 'min_cash_reserve_usd' as const,
    name: 'Operating Cash Floor',
    limit_value: '500000',
    limit_currency: 'USD',
    scope: {},
  };

  it('accepts a valid min_cash_reserve_usd row', () => {
    expect(hardLimitSchema.safeParse(baseValid).success).toBe(true);
  });

  it('accepts a max_single_asset_concentration_pct row with no currency', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '70',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects max_single_asset_concentration_pct with value > 100', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '150',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects max_single_asset_concentration_pct with negative value', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '-10',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('accepts obligation_coverage_days with integer day count', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '14',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects obligation_coverage_days with a non-integer', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '14.5',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('accepts max_native_exposure with required asset scope', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_native_exposure',
      limit_value: '10000000',
      limit_currency: 'USDT',
      scope: { asset: 'USDT' },
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects max_native_exposure without asset scope', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_native_exposure',
      limit_value: '10000000',
      limit_currency: 'USDT',
      scope: {},
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects a negative min_cash_reserve_usd', () => {
    const row = { ...baseValid, limit_value: '-100' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an unknown limit_type', () => {
    const row = { ...baseValid, limit_type: 'bogus_limit' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('accepts a max_daily_outflow_usd row', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_daily_outflow_usd',
      limit_value: '1000000',
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('accepts a max_30day_outflow_usd row', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_30day_outflow_usd',
      limit_value: '20000000',
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects extra unknown fields on hard limit (strict)', () => {
    const row = {
      ...baseValid,
      malicious_extra: 'rides along',
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects an unknown limit_currency (closed asset code set)', () => {
    const row = {
      ...baseValid,
      limit_currency: 'ZWL',
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('accepts a row with undefined limit_currency', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '14',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(true);
  });

  it('rejects an empty name', () => {
    const row = { ...baseValid, name: '' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  // ─── C1: parseFloat bypass regressions ───────────────────────────────
  it('rejects max_single_asset_concentration_pct with "50foo" (parseFloat bypass)', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '50foo',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects max_single_asset_concentration_pct with "0xFF" (parseFloat bypass)', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '0xFF',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects max_single_asset_concentration_pct with "50 %" (trailing garbage)', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '50 %',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  // ─── I1: cross-field currency semantics ──────────────────────────────
  it('rejects min_cash_reserve_usd with limit_currency=undefined (must be USD)', () => {
    const row = { ...baseValid, limit_currency: undefined };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects min_cash_reserve_usd with limit_currency=USDC (not USD)', () => {
    const row = { ...baseValid, limit_currency: 'USDC' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects max_single_asset_concentration_pct when limit_currency is set', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_single_asset_concentration_pct',
      limit_value: '70',
      limit_currency: 'USD',
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects obligation_coverage_days when limit_currency is set', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '14',
      limit_currency: 'USD',
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects max_native_exposure with no limit_currency', () => {
    const row = {
      ...baseValid,
      limit_type: 'max_native_exposure',
      limit_value: '10000000',
      limit_currency: undefined,
      scope: { asset: 'USDT' },
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  // ─── I2/I3/I4: bounded values ────────────────────────────────────────
  it('rejects obligation_coverage_days with value 0 (tautology)', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '0',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects obligation_coverage_days beyond the 365-day ceiling', () => {
    const row = {
      ...baseValid,
      limit_type: 'obligation_coverage_days',
      limit_value: '400',
      limit_currency: undefined,
    };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects min_cash_reserve_usd with value 0 (use a rule for total freeze)', () => {
    const row = { ...baseValid, limit_value: '0' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects min_cash_reserve_usd exceeding MAX_MONETARY_USD ceiling', () => {
    // 1e15 + 1
    const row = { ...baseValid, limit_value: '1000000000000001' };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });

  it('rejects min_cash_reserve_usd with absurdly long decimal digits', () => {
    const row = { ...baseValid, limit_value: '1'.repeat(50) };
    expect(hardLimitSchema.safeParse(row).success).toBe(false);
  });
});
