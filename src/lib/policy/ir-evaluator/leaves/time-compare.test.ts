import { describe, it, expect } from 'vitest';
import { evalTimeCompare } from './time-compare';
import { TimeCompareNode } from '../../types/ir';
import { EvaluationContext } from '../../types/context';

const makeContext = (now: Date, overrides: Partial<EvaluationContext> = {}): EvaluationContext => ({
  now,
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
    results: {},
  },
  counterparty: { id: 'cp-1', last_transfer_at: new Date('2026-04-10T10:00:00.000Z') },
  ...overrides,
});

describe('evalTimeCompare', () => {
  it('now.day_of_week returns 5 for Friday 2026-04-10', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.day_of_week',
      op: '==',
      value: 5,
    };
    // 2026-04-10 is a Friday (getUTCDay() === 5)
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(true);
  });

  it('now.hour_local matches hour of day (UTC in phase-1)', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: '>=',
      value: 9,
    };
    const ctx = makeContext(new Date('2026-04-10T14:00:00.000Z'));
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(true); // 14 >= 9
  });

  it('now.is_business_hours returns true for 10am UTC Tuesday', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: '==',
      value: true,
    };
    const ctx = makeContext(new Date('2026-04-07T10:00:00.000Z')); // Tuesday 10 UTC
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(true);
  });

  it('now.is_business_hours returns false for 3am Sunday', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: '==',
      value: true,
    };
    const ctx = makeContext(new Date('2026-04-05T03:00:00.000Z')); // Sunday 3am
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(false);
  });

  it('time_since_last_to_counterparty uses ctx.counterparty.last_transfer_at', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'time_since_last_to_counterparty',
      op: '<',
      value: 60 * 60 * 1000, // less than 1 hour
    };
    const ctx = makeContext(new Date('2026-04-10T10:30:00.000Z')); // 30 min after last_transfer_at
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(true);
  });

  it('time_since_last_to_counterparty returns matched=false (no failure) if no counterparty history', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'time_since_last_to_counterparty',
      op: '<',
      value: 3600000,
    };
    const ctx = makeContext(new Date('2026-04-10T14:00:00.000Z'), { counterparty: undefined });
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure).toBeUndefined();
  });

  // Watch-out tests
  it('returns structured failure when last_transfer_at is in the future (clock skew)', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'time_since_last_to_counterparty',
      op: '<',
      value: 3600000,
    };
    const ctx = makeContext(new Date('2026-04-10T10:00:00.000Z'), {
      counterparty: { id: 'cp-1', last_transfer_at: new Date('2026-04-10T12:00:00.000Z') },
    });
    const result = evalTimeCompare(node, ctx);
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('negative');
  });

  it('time_since_last_by_initiator returns structured failure (phase-1 unsupported)', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'time_since_last_by_initiator',
      op: '<',
      value: 3600000,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('phase 1');
  });

  it('returns structured failure when boolean attribute is paired with non-equality operator', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: '>',
      value: true,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-07T10:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('boolean');
  });

  it('contract: matched=true results have failure undefined', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.day_of_week',
      op: '==',
      value: 5,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(true);
    expect(result.failure).toBeUndefined();
  });

  // Coverage: boolean op mismatch fires for ALL non-equality operators
  it.each([['<' as const], ['<=' as const], ['>=' as const]])(
    'returns structured failure for boolean attribute with op=%s',
    (op) => {
      const node: TimeCompareNode = {
        kind: 'time_compare',
        attr: 'now.is_business_hours',
        op,
        value: true,
      };
      const result = evalTimeCompare(node, makeContext(new Date('2026-04-07T10:00:00.000Z')));
      expect(result.matched).toBe(false);
      expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    },
  );

  it('returns structured failure for boolean attribute with op=in', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: 'in',
      // TimeValue arrays are (number|string)[] per the schema; intentional cast
      // to verify the runtime guard catches a schema-bypassed boolean array.
      value: [true] as unknown as (number | string)[],
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-07T10:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  // Coverage: boolean != true outside business hours
  it('is_business_hours != true matches outside business hours', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.is_business_hours',
      op: '!=',
      value: true,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-05T03:00:00.000Z'))); // Sunday 3am
    expect(result.matched).toBe(true);
  });

  // Coverage: hour_local in [...] for a daytime range
  it('hour_local in [9..16] matches business-hours range (positive)', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: 'in',
      value: [9, 10, 11, 12, 13, 14, 15, 16],
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(true);
  });

  it('hour_local in [9..16] does not match outside the range (negative)', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: 'in',
      value: [9, 10, 11, 12, 13, 14, 15, 16],
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T03:00:00.000Z')));
    expect(result.matched).toBe(false);
  });

  // Watch-out: malformed numeric RHS rejected as structured failure (not silent match)
  it('returns structured failure when numeric op is paired with null value', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: '>',
      // intentional schema bypass — schema should reject, defense in depth
      value: null as unknown as number,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('null');
  });

  it('returns structured failure when numeric op is paired with boolean value', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: '>',
      value: true as unknown as number,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
    expect(result.failure?.human_readable).toContain('boolean');
  });

  it('returns structured failure when numeric op is paired with empty string', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: '>',
      value: '' as unknown as number,
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('returns structured failure when in is paired with non-array value', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: 'in',
      value: 14 as unknown as number[],
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });

  it('returns structured failure when in array contains a non-numeric element', () => {
    const node: TimeCompareNode = {
      kind: 'time_compare',
      attr: 'now.hour_local',
      op: 'in',
      value: [9, 10, 'eleven' as unknown as number, 12],
    };
    const result = evalTimeCompare(node, makeContext(new Date('2026-04-10T14:00:00.000Z')));
    expect(result.matched).toBe(false);
    expect(result.failure?.reason_code).toBe('condition_node_evaluation_failed');
  });
});
