import { describe, it, expect } from 'vitest';
import { evalForecastQuery, computeForecastQueryHash } from './forecast-query';
import { ForecastQueryNode } from '../../types/ir';
import { EvaluationContext, ForecastQueryResult } from '../../types/context';

const makeContext = (results: Record<string, ForecastQueryResult>): EvaluationContext => ({
  now: new Date(),
  enterprise_id: 'ent-1',
  policy_version: {
    id: 'v-1',
    enterprise_id: 'ent-1',
    version_number: 1,
    status: 'active',
    name: 'Test',
    rules: [],
    hard_limits: [],
    approval_chains: [],
  },
  treasury_state: {
    positions_by_asset: {},
    positions_by_asset_venue: {},
    positions_usd_by_asset: {},
    total_treasury_usd: '0',
    cash_equivalent_usd: '0',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '0',
    native_asset: 'USDC',
    canonical_amount: '0',
    canonical_currency: 'USD',
    rate: '1',
    rate_source: 'test',
    rate_as_of: new Date(),
    max_age_ms: 60000,
  },
  aggregates: {
    system_splitting_guard_24h: {
      window_spec_hash: 'sys',
      window_start: new Date(),
      window_end: new Date(),
      sum_amount_usd: '0',
      sum_amount_by_asset: {},
      count: 0,
      distinct_destinations: 0,
      distinct_counterparties: 0,
      included_evaluation_ids: [],
      includes_proposed: false,
    },
    user_specs: {},
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results,
  },
});

describe('evalForecastQuery — obligations_covered', () => {
  it('matches when obligations_covered result equals expected (covered=true)', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: true, obligations_checked: 5, obligations_uncovered: 0 } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  it('does not match when obligations_covered returns false but rule expects true', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: false, obligations_checked: 5, obligations_uncovered: 2 } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
  });

  it('matches with != when expected differs', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '!=',
      value: { amount: '1', currency: 'USD' }, // expected true; result false → != matches
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: false, obligations_checked: 5, obligations_uncovered: 2 } },
    });
    expect(evalForecastQuery(node, ctx).matched).toBe(true);
  });

  it('accepts threshold "true"/"false" string forms', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: 'true', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: true, obligations_checked: 5, obligations_uncovered: 0 } },
    });
    expect(evalForecastQuery(node, ctx).matched).toBe(true);
  });

  it('returns structured failure when obligations_covered uses a non-equality comparator', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '>',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: true, obligations_checked: 5, obligations_uncovered: 0 } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('==');
  });

  it('returns structured failure for malformed threshold (not "1"/"0"/"true"/"false")', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: 'maybe', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: true, obligations_checked: 5, obligations_uncovered: 0 } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('threshold');
  });

  it('returns structured failure when obligations_covered payload is malformed', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: 'yes' as unknown as boolean } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('malformed');
  });
});

describe('evalForecastQuery — projected_min_balance / projected_position', () => {
  it('compares projected_min_balance against threshold (matches)', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '750000', asset: 'USDC' } },
    });
    expect(evalForecastQuery(node, ctx).matched).toBe(true);
  });

  it('compares projected_min_balance against threshold (does not match)', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '300000', asset: 'USDC' } },
    });
    expect(evalForecastQuery(node, ctx).matched).toBe(false);
  });

  it('compares projected_position similarly', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_position',
      window_days: 30,
      scope: { asset: 'USDT' },
      comparator: '<',
      value: { amount: '1000000', currency: 'USDT' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '500000', asset: 'USDT' } },
    });
    expect(evalForecastQuery(node, ctx).matched).toBe(true);
  });

  it('returns structured failure when projected_min_balance payload is malformed', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { covered: true } as unknown }, // wrong shape
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('returns structured failure when projected payload amount is malformed (big.js throws)', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: 'garbage', asset: 'USDC' } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('malformed amount');
  });
});

describe('evalForecastQuery — failure paths', () => {
  it('returns failure when the forecast result has a failure field', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: {
        failure: {
          reason_code: 'forecast_unavailable',
          human_readable: 'Forecast service down',
          details: {},
        },
      },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('returns failure when the required forecast result is missing from context', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },
    };
    const ctx = makeContext({});
    const result = evalForecastQuery(node, ctx);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('returns structured failure when comparator is between (forecast_query has no value_upper)', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: 'between',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '750000', asset: 'USDC' } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('between');
  });

  // Watch-out: empty-string amount must be a structured failure, NOT silent no-match
  it('returns structured failure when projected_min_balance amount is empty string (loader partial-load bug)', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '', asset: 'USDC' } }, // partial load — empty amount, no failure flag
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('empty');
  });

  // Watch-out: hash is canonical regardless of scope key insertion order
  it('computeForecastQueryHash is invariant across scope key insertion order', () => {
    const a: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC', venue: 'ethereum' },
      comparator: '>',
      value: { amount: '1', currency: 'USD' },
    };
    const b: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      // intentionally different insertion order
      scope: { venue: 'ethereum', asset: 'USDC' },
      comparator: '>',
      value: { amount: '1', currency: 'USD' },
    };
    expect(computeForecastQueryHash(a)).toBe(computeForecastQueryHash(b));
  });

  it('contract: matched=true results have failure undefined', () => {
    const node: ForecastQueryNode = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: 7,
      scope: { asset: 'USDC' },
      comparator: '>',
      value: { amount: '500000', currency: 'USDC' },
    };
    const hash = computeForecastQueryHash(node);
    const ctx = makeContext({
      [hash]: { value: { amount: '750000', asset: 'USDC' } },
    });
    const result = evalForecastQuery(node, ctx);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});
