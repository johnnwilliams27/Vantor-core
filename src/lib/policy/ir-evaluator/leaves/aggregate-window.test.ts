import { describe, it, expect } from 'vitest';
import { evalAggregateWindow } from './aggregate-window';
import { AggregateWindowNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';
import { computeWindowSpecHash } from '../../aggregate-detector/hash';

const makeContext = (
  userSpecs: EvaluationContext['aggregates']['user_specs'],
): EvaluationContext => ({
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
    user_specs: userSpecs,
  },
  sanctions: { status: 'clear' },
  forecast: {
    query_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    hypothetical_metadata: { mode: 'stub', snapshot_taken_at: new Date(), source: 'stub', warnings: [] },
    results: {},
  },
});

describe('evalAggregateWindow', () => {
  it('matches when sum_amount in the window exceeds threshold', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '200000', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '250000',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 3,
        distinct_counterparties: 1,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('matches when count attribute exceeds threshold', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 3_600_000,
        group_by: { initiator: true },
      },
      attr: 'count',
      op: '>',
      value: { amount: '5', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '0',
        sum_amount_by_asset: {},
        count: 8,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('matches on distinct_destinations', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 3_600_000,
        group_by: { initiator: true },
      },
      attr: 'distinct_destinations',
      op: '>',
      value: { amount: '3', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '0',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 5,
        distinct_counterparties: 2,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('matches on distinct_counterparties', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 3_600_000,
        group_by: { initiator: true },
      },
      attr: 'distinct_counterparties',
      op: '>=',
      value: { amount: '2', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '0',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 3,
        distinct_counterparties: 2,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    expect(evalAggregateWindow(node, ctx).matched).toBe(true);
  });

  it('returns failure when the result is missing', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const ctx = makeContext({});
    const result = evalAggregateWindow(node, ctx);
    expect(result.failure?.reason_code).toBe('aggregate_query_failed');
  });

  it('returns failure when the result has a failure field', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '',
        sum_amount_by_asset: {},
        count: 0,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
        includes_proposed: false,
        failure: {
          reason_code: 'aggregate_query_failed',
          human_readable: 'Query timed out',
          details: {},
        },
      },
    });
    expect(evalAggregateWindow(node, ctx).failure?.reason_code).toBe('aggregate_query_failed');
  });

  // Watch-out tests
  it('returns structured failure when op is between (no value_upper field)', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: 'between',
      value: { amount: '100', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '500',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 1,
        distinct_counterparties: 1,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    const result = evalAggregateWindow(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('between');
  });

  it('returns structured failure when sum_amount_usd is malformed (big.js throws)', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: 'garbage',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 1,
        distinct_counterparties: 1,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    const result = evalAggregateWindow(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('malformed');
  });

  // Watch-out: empty-string sum_amount_usd must be a structured failure, NOT silent no-match
  it('returns structured failure when sum_amount_usd is empty string with no failure flag (loader partial-load bug)', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '', // partial load — empty amount, no failure flag
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 1,
        distinct_counterparties: 1,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    const result = evalAggregateWindow(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('empty');
  });

  it('contract: matched=true results have failure undefined', () => {
    const node: AggregateWindowNode = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { counterparty: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '100', currency: 'USD' },
    };
    const hash = computeWindowSpecHash(node.window);
    const ctx = makeContext({
      [hash]: {
        window_spec_hash: hash,
        window_start: new Date(),
        window_end: new Date(),
        sum_amount_usd: '500',
        sum_amount_by_asset: {},
        count: 5,
        distinct_destinations: 1,
        distinct_counterparties: 1,
        included_evaluation_ids: [],
        includes_proposed: false,
      },
    });
    const result = evalAggregateWindow(node, ctx);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});
