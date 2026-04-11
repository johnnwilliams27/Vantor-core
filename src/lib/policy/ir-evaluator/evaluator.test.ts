import { describe, it, expect } from 'vitest';
import { evalCondition } from './evaluator';
import { Condition } from '../types/ir';
import { ProposedMovement } from '../types/movement';
import { EvaluationContext } from '../types/context';

const mkMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '50000', asset: 'USDC' },
  counterparty: { id: 'cp-1', type: 'known' },
  initiator: { type: 'human', user_id: 'user-1' },
  purpose_code: 'payroll',
  rail: 'ethereum',
  requested_at: '2026-04-10T14:22:33.000Z',
});

const mkContext = (): EvaluationContext => ({
  now: new Date('2026-04-10T14:22:33.000Z'),
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
    positions_by_asset: { USDC: '1000000' },
    positions_by_asset_venue: { 'USDC:ethereum': '800000' },
    positions_usd_by_asset: { USDC: '1000000' },
    total_treasury_usd: '1000000',
    cash_equivalent_usd: '1000000',
    loaded_at: new Date(),
  },
  canonicalization: {
    native_amount: '50000',
    native_asset: 'USDC',
    canonical_amount: '50010',
    canonical_currency: 'USD',
    rate: '1.0002',
    rate_source: 'coingecko',
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
    results: {},
  },
});

describe('evalCondition — leaf dispatch', () => {
  it('dispatches amount_compare to its evaluator', () => {
    const cond: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '10000', currency: 'USDC' },
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
  });

  it('dispatches string_compare', () => {
    const cond: Condition = {
      kind: 'string_compare',
      attr: 'transfer.initiator_type',
      op: '==',
      value: 'human',
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('dispatches sanctions_status', () => {
    const cond: Condition = {
      kind: 'sanctions_status',
      op: 'not_in',
      values: ['sanctioned', 'partial_match'],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('dispatches time_compare', () => {
    const cond: Condition = {
      kind: 'time_compare',
      attr: 'now.day_of_week',
      op: '==',
      value: 5, // Friday
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });
});

describe('evalCondition — AND', () => {
  it('returns true when all children match', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('returns false when any child does not match', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
  });

  it('propagates child failure as AND failure (fail-fast on first failure)', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        }, // will fail: no forecast result
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('AND fail-fasts on the FIRST failing child (does not evaluate later children)', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        }, // will fail
        {
          kind: 'forecast_query',
          query: 'projected_min_balance',
          window_days: 7,
          scope: { asset: 'USDC' },
          comparator: '>',
          value: { amount: '500000', currency: 'USDC' },
        }, // would also fail
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
    expect((result.evaluation_details as { failed_child_index?: number }).failed_child_index).toBe(0);
  });

  it('AND surfaces failure on the SECOND child after the first cleanly matches', () => {
    // matching child first, failing child second — verifies the loop continues
    // past matched children and correctly captures the failure index
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' }, // matches
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        }, // fails
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
    expect((result.evaluation_details as { failed_child_index?: number }).failed_child_index).toBe(1);
  });

  it('empty AND is vacuously true', () => {
    const cond: Condition = { kind: 'and', children: [] };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
    expect((result.evaluation_details as { vacuous?: boolean }).vacuous).toBe(true);
  });
});

describe('evalCondition — OR', () => {
  it('returns true when any child matches (short-circuits on first match)', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' }, // false
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' }, // true
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('returns false when no child matches and no failures', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'schedule' },
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
  });

  it('a matching child rescues the OR even when a sibling has a failure', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        }, // failure
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' }, // matches
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  it('returns the FIRST child failure when no child matched (forecast first, aggregate second)', () => {
    const cond: Condition = {
      kind: 'or',
      children: [
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        }, // forecast_unavailable
        {
          kind: 'aggregate_window',
          window: { duration_ms: 86_400_000, group_by: { counterparty: true } },
          attr: 'sum_amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        }, // aggregate_query_failed
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('forecast_unavailable'); // first failure wins
  });

  it('returns the FIRST child failure when no child matched (aggregate first, forecast second — order matters)', () => {
    // Same payload as the previous test but children swapped — verifies
    // the order-dependence is real (first-in-children-order, not e.g. alphabetical)
    const cond: Condition = {
      kind: 'or',
      children: [
        {
          kind: 'aggregate_window',
          window: { duration_ms: 86_400_000, group_by: { counterparty: true } },
          attr: 'sum_amount',
          op: '>',
          value: { amount: '1', currency: 'USD' },
        }, // aggregate_query_failed (now first)
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        }, // forecast_unavailable (now second)
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('aggregate_query_failed'); // first failure wins
  });

  it('empty OR is vacuously false', () => {
    const cond: Condition = { kind: 'or', children: [] };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
    expect((result.evaluation_details as { vacuous?: boolean }).vacuous).toBe(true);
  });
});

describe('evalCondition — NOT', () => {
  it('negates a matching child', () => {
    const cond: Condition = {
      kind: 'not',
      child: { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(false);
  });

  it('negates a non-matching child', () => {
    const cond: Condition = {
      kind: 'not',
      child: { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('propagates child failure as NOT failure (cannot-fully-evaluate)', () => {
    const cond: Condition = {
      kind: 'not',
      child: {
        kind: 'forecast_query',
        query: 'obligations_covered',
        window_days: 14,
        comparator: '==',
        value: { amount: '1', currency: 'USD' },
      },
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.failure?.reason_code).toBe('forecast_unavailable');
  });

  it('NOT(NOT(x)) is x', () => {
    const cond: Condition = {
      kind: 'not',
      child: {
        kind: 'not',
        child: { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
      },
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });
});

describe('evalCondition — nested composition', () => {
  it('handles AND-of-ORs', () => {
    // (initiator==human OR initiator==agent) AND (rail==ethereum OR rail==solana)
    const cond: Condition = {
      kind: 'and',
      children: [
        {
          kind: 'or',
          children: [
            { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
            { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'agent' },
          ],
        },
        {
          kind: 'or',
          children: [
            { kind: 'string_compare', attr: 'transfer.rail', op: '==', value: 'ethereum' },
            { kind: 'string_compare', attr: 'transfer.rail', op: '==', value: 'solana' },
          ],
        },
      ],
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(true);
  });

  it('handles OR-of-ANDs with one branch matching and one failing', () => {
    // (amount > 10000 USDC AND initiator == human) OR (forecast_query that fails)
    const cond: Condition = {
      kind: 'or',
      children: [
        {
          kind: 'and',
          children: [
            { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
            { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
          ],
        },
        {
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: 14,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        },
      ],
    };
    // First branch matches → OR returns true even though second branch would fail
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  it('handles NOT(AND(...)) — De Morgan', () => {
    // NOT (initiator == human AND amount > 10000) — should be false
    const cond: Condition = {
      kind: 'not',
      child: {
        kind: 'and',
        children: [
          { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
          { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
        ],
      },
    };
    expect(evalCondition(cond, mkMovement(), mkContext(), []).matched).toBe(false);
  });
});

describe('evalCondition — recursion depth guard', () => {
  it('returns structured failure when condition tree exceeds MAX_EVALUATION_DEPTH', () => {
    // Build a deeply-nested NOT chain past the 64-deep guard
    let cond: Condition = { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' };
    for (let i = 0; i < 70; i++) {
      cond = { kind: 'not', child: cond };
    }
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('depth');
  });
});

describe('evalCondition — contract invariant', () => {
  it('matched=true results have failure undefined', () => {
    const cond: Condition = {
      kind: 'and',
      children: [
        { kind: 'amount_compare', attr: 'transfer.amount', op: '>', value: { amount: '10000', currency: 'USDC' } },
        { kind: 'string_compare', attr: 'transfer.initiator_type', op: '==', value: 'human' },
      ],
    };
    const result = evalCondition(cond, mkMovement(), mkContext(), []);
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });
});
