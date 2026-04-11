import { describe, it, expect } from 'vitest';
import {
  PolicyError,
  CanonicalizationError,
  CanonicalizationSourceUnavailableError,
  CanonicalizationRateStaleError,
  HardLimitBreachError,
  ForecastUnavailableError,
  AggregateQueryFailedError,
} from './classes';
import { REASON_CODES } from './reason-codes';

describe('PolicyError', () => {
  it('carries reason_code, human_readable, details, and user_action', () => {
    const err = new PolicyError({
      reason_code: REASON_CODES.gate_internal_error,
      module: 'gate',
      human_readable: 'Something went wrong.',
      user_action: 'Retry or contact support.',
      details: { foo: 'bar' },
    });

    expect(err.reason_code).toBe('gate_internal_error');
    expect(err.module).toBe('gate');
    expect(err.human_readable).toBe('Something went wrong.');
    expect(err.user_action).toBe('Retry or contact support.');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('gate_internal_error');
  });

  it('serializes to a structured object via toJSON()', () => {
    const err = new PolicyError({
      reason_code: REASON_CODES.canonicalization_failed,
      module: 'canonicalizer',
      human_readable: 'Rate unavailable',
      user_action: 'Retry',
      details: { from: 'USDC', to: 'USD' },
    });

    const serialized = err.toJSON();
    expect(serialized).toMatchObject({
      reason_code: 'canonicalization_failed',
      module: 'canonicalizer',
      human_readable: 'Rate unavailable',
      user_action: 'Retry',
      details: { from: 'USDC', to: 'USD' },
    });
  });

  it('propagates cause through super() and serializes name+message in envelope', () => {
    const underlying = new TypeError('rate fetch timed out');
    const err = new PolicyError({
      reason_code: REASON_CODES.canonicalization_failed,
      module: 'canonicalizer',
      human_readable: 'Rate unavailable',
      user_action: 'Retry in 30 seconds',
      details: {},
      cause: underlying,
    });

    expect(err.cause).toBe(underlying);
    // ES2022 Error.cause
    expect((err as Error & { cause?: unknown }).cause).toBe(underlying);

    const env = err.toJSON();
    expect(env.cause).toEqual({ name: 'TypeError', message: 'rate fetch timed out' });
  });

  it('omits cause from envelope when not provided', () => {
    const err = new PolicyError({
      reason_code: REASON_CODES.gate_internal_error,
      module: 'gate',
      human_readable: 'x',
      user_action: 'y',
    });
    expect(err.toJSON().cause).toBeUndefined();
  });

  it('accepts an injected occurred_at for deterministic testing', () => {
    const frozen = '2026-01-01T00:00:00.000Z';
    const err = new PolicyError({
      reason_code: REASON_CODES.gate_internal_error,
      module: 'gate',
      human_readable: 'x',
      user_action: 'y',
      occurred_at: frozen,
    });
    expect(err.occurred_at).toBe(frozen);
    expect(err.toJSON().occurred_at).toBe(frozen);
  });

  it('generates a valid ISO timestamp when occurred_at is not provided', () => {
    const err = new PolicyError({
      reason_code: REASON_CODES.gate_internal_error,
      module: 'gate',
      human_readable: 'x',
      user_action: 'y',
    });
    expect(err.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('CanonicalizationError', () => {
  it('is a PolicyError with reason_code=canonicalization_failed', () => {
    const err = new CanonicalizationError({
      human_readable: 'Cannot convert BTC to USD',
      user_action: 'Add BTC rate source',
      details: { from: 'BTC', to: 'USD', source_status: 'unsupported' },
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err.reason_code).toBe('canonicalization_failed');
    expect(err.module).toBe('canonicalizer');
    expect(err.details).toMatchObject({ from: 'BTC', to: 'USD' });
  });
});

describe('CanonicalizationSourceUnavailableError', () => {
  it('is a PolicyError with reason_code=canonicalization_source_unavailable', () => {
    const err = new CanonicalizationSourceUnavailableError({
      human_readable: 'Rate provider unreachable',
      user_action: 'Retry in a few minutes',
      details: { from_asset: 'USDC', to_asset: 'USD', oracle_source: 'mock' },
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err).toBeInstanceOf(CanonicalizationError);
    expect(err.reason_code).toBe('canonicalization_source_unavailable');
    expect(err.module).toBe('canonicalizer');
    expect(err.name).toBe('CanonicalizationSourceUnavailableError');
    expect(err.details).toMatchObject({ from_asset: 'USDC' });
  });
});

describe('CanonicalizationRateStaleError', () => {
  it('is a PolicyError with reason_code=canonicalization_rate_stale', () => {
    const err = new CanonicalizationRateStaleError({
      human_readable: 'Rate too old',
      user_action: 'Check oracle health',
      details: { rate_age_ms: 120_000, max_age_ms: 60_000 },
    });

    expect(err).toBeInstanceOf(PolicyError);
    expect(err).toBeInstanceOf(CanonicalizationError);
    expect(err.reason_code).toBe('canonicalization_rate_stale');
    expect(err.module).toBe('canonicalizer');
    expect(err.name).toBe('CanonicalizationRateStaleError');
    expect(err.details.rate_age_ms).toBe(120_000);
  });
});

describe('HardLimitBreachError', () => {
  it('carries limit_type and is not throwable at API boundary (structured only)', () => {
    const err = new HardLimitBreachError({
      human_readable: 'Cash reserve floor breached',
      user_action: 'Reduce transfer amount',
      details: {
        limit_type: 'min_cash_reserve_usd',
        limit_value: '500000',
        post_transfer_value: '470000',
        overage: '30000',
      },
    });

    expect(err.reason_code).toBe('hard_limit_breached');
    expect(err.details.limit_type).toBe('min_cash_reserve_usd');
  });
});

describe('ForecastUnavailableError', () => {
  it('has reason_code=forecast_unavailable', () => {
    const err = new ForecastUnavailableError({
      human_readable: 'Forecast query failed',
      user_action: 'Retry later',
      details: { query: 'obligations_covered', window_days: 14 },
    });

    expect(err.reason_code).toBe('forecast_unavailable');
  });
});

describe('AggregateQueryFailedError', () => {
  it('has reason_code=aggregate_query_failed', () => {
    const err = new AggregateQueryFailedError({
      human_readable: 'Window query failed',
      user_action: 'Retry',
      details: { window_spec: { duration_ms: 86400000 } },
    });

    expect(err.reason_code).toBe('aggregate_query_failed');
  });
});
