import { describe, it, expect } from 'vitest';
import { conditionSchema } from './ir.schema';
import { Condition } from '../types/ir';

describe('conditionSchema — amount_compare', () => {
  it('accepts a simple transfer.amount > $50k', () => {
    const condition: Condition = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('requires value_upper when op=between', () => {
    const noUpper = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(noUpper).success).toBe(false);

    const withUpper = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: 'between',
      value: { amount: '10000', currency: 'USD' },
      value_upper: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(withUpper).success).toBe(true);
  });

  it('rejects an invalid operator', () => {
    const bad = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '~=',
      value: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing currency on value', () => {
    const bad = {
      kind: 'amount_compare',
      attr: 'transfer.amount',
      op: '>',
      value: { amount: '50000' },  // no currency
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — composition (and/or/not)', () => {
  it('accepts nested AND/OR with mixed leaves', () => {
    const condition: Condition = {
      kind: 'and',
      children: [
        {
          kind: 'amount_compare',
          attr: 'transfer.amount',
          op: '>',
          value: { amount: '50000', currency: 'USD' },
        },
        {
          kind: 'or',
          children: [
            {
              kind: 'string_compare',
              attr: 'transfer.initiator_type',
              op: '==',
              value: 'human',
            },
            {
              kind: 'sanctions_status',
              op: 'not_in',
              values: ['sanctioned', 'partial_match'],
            },
          ],
        },
      ],
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('accepts a NOT wrapping an amount_compare', () => {
    const condition: Condition = {
      kind: 'not',
      child: {
        kind: 'amount_compare',
        attr: 'transfer.amount',
        op: '<',
        value: { amount: '100', currency: 'USD' },
      },
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects an empty AND/OR children array', () => {
    const emptyAnd = { kind: 'and', children: [] };
    expect(conditionSchema.safeParse(emptyAnd).success).toBe(false);

    const emptyOr = { kind: 'or', children: [] };
    expect(conditionSchema.safeParse(emptyOr).success).toBe(false);
  });
});

describe('conditionSchema — string_compare', () => {
  it('accepts op=in with array value', () => {
    const condition: Condition = {
      kind: 'string_compare',
      attr: 'transfer.counterparty_id',
      op: 'in',
      value: ['cp-1', 'cp-2', 'cp-3'],
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('accepts op=== with string value', () => {
    const condition: Condition = {
      kind: 'string_compare',
      attr: 'transfer.purpose_code',
      op: '==',
      value: 'payroll',
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });
});

describe('conditionSchema — sanctions_status', () => {
  it('accepts not_in with status list', () => {
    const condition: Condition = {
      kind: 'sanctions_status',
      op: 'not_in',
      values: ['clear'],
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects an empty values array', () => {
    const bad = {
      kind: 'sanctions_status',
      op: 'in',
      values: [],
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — forecast_query', () => {
  it('accepts a valid forecast query node', () => {
    const condition: Condition = {
      kind: 'forecast_query',
      query: 'obligations_covered',
      window_days: 14,
      comparator: '==',
      value: { amount: '1', currency: 'USD' },   // 1 = true for bool comparison
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects a negative window_days', () => {
    const bad = {
      kind: 'forecast_query',
      query: 'projected_min_balance',
      window_days: -1,
      comparator: '>',
      value: { amount: '500000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — aggregate_window', () => {
  it('accepts a 24h sum by initiator+destination', () => {
    const condition: Condition = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 86_400_000,
        group_by: { initiator: true, destination: true },
      },
      attr: 'sum_amount',
      op: '>',
      value: { amount: '50000', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(condition).success).toBe(true);
  });

  it('rejects a zero-duration window', () => {
    const bad = {
      kind: 'aggregate_window',
      window: {
        duration_ms: 0,
        group_by: { initiator: true },
      },
      attr: 'count',
      op: '>',
      value: { amount: '10', currency: 'USD' },
    };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('conditionSchema — unknown kinds', () => {
  it('rejects a node with an unknown kind', () => {
    const bad = { kind: 'bogus_kind', foo: 'bar' };
    expect(conditionSchema.safeParse(bad).success).toBe(false);
  });
});
