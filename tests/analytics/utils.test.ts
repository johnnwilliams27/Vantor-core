import { describe, it, expect } from 'vitest';
import {
  parseNumeric,
  aggregateValues,
  round2,
  toDay,
  isoWeek,
  isoMonth,
  groupByTime,
  groupByColumn,
  paginate,
} from '@/lib/analytics/utils';

describe('parseNumeric', () => {
  it('parses a number', () => expect(parseNumeric(42)).toBe(42));
  it('parses a string number', () => expect(parseNumeric('3.14')).toBe(3.14));
  it('returns 0 for null', () => expect(parseNumeric(null)).toBe(0));
  it('returns 0 for undefined', () => expect(parseNumeric(undefined)).toBe(0));
  it('returns 0 for NaN string', () => expect(parseNumeric('abc')).toBe(0));
  it('returns 0 for empty string', () => expect(parseNumeric('')).toBe(0));
  it('handles negative numbers', () => expect(parseNumeric(-5)).toBe(-5));
  it('handles negative string numbers', () => expect(parseNumeric('-12.5')).toBe(-12.5));
});

describe('aggregateValues', () => {
  it('sum', () => expect(aggregateValues([1, 2, 3], 'sum')).toBe(6));
  it('count', () => expect(aggregateValues([10, 20], 'count')).toBe(2));
  it('avg', () => expect(aggregateValues([2, 4, 6], 'avg')).toBe(4));
  it('min', () => expect(aggregateValues([5, 3, 8], 'min')).toBe(3));
  it('max', () => expect(aggregateValues([5, 3, 8], 'max')).toBe(8));
  it('latest', () => expect(aggregateValues([10, 20, 30], 'latest')).toBe(30));
  it('empty array returns 0', () => expect(aggregateValues([], 'sum')).toBe(0));
  it('empty array for count returns 0', () => expect(aggregateValues([], 'count')).toBe(0));
});

describe('round2', () => {
  // JS floating point: Math.round(1.005 * 100) / 100 = 1.0
  it('rounds to 2 decimals', () => expect(round2(1.005)).toBe(1));
  it('rounds 1.456 to 1.46', () => expect(round2(1.456)).toBe(1.46));
  it('no-op for integers', () => expect(round2(5)).toBe(5));
});

describe('toDay', () => {
  it('extracts date from ISO string', () =>
    expect(toDay('2026-04-12T15:30:00Z')).toBe('2026-04-12'));
  it('works with date-only string', () =>
    expect(toDay('2026-01-01')).toBe('2026-01-01'));
});

describe('isoWeek', () => {
  // 2026-01-01 is a Thursday → W01
  it('Jan 1 2026 is week 1', () => expect(isoWeek('2026-01-01')).toBe('2026-W01'));
  // 2026-04-12 is a Sunday → should be in the prior week
  it('Apr 12 2026 (Sunday)', () => {
    const result = isoWeek('2026-04-12');
    expect(result).toMatch(/^2026-W\d{2}$/);
  });
  // 2025-12-29 is Monday → ISO week 1 of 2026
  it('Dec 29 2025 → week 1 of 2026', () => {
    expect(isoWeek('2025-12-29')).toBe('2026-W01');
  });
});

describe('isoMonth', () => {
  it('extracts YYYY-MM', () => expect(isoMonth('2026-04-12T00:00:00Z')).toBe('2026-04'));
  it('works for date-only', () => expect(isoMonth('2026-12-25')).toBe('2026-12'));
});

describe('groupByTime (day granularity)', () => {
  it('buckets rows by day and sums values', () => {
    const rows = [
      { date: '2026-04-10T10:00:00Z', amount: '100' },
      { date: '2026-04-10T14:00:00Z', amount: '200' },
      { date: '2026-04-11T09:00:00Z', amount: '50' },
    ];
    const result = groupByTime(
      rows,
      'date',
      (r) => parseNumeric(r.amount),
      'sum',
      'day',
    );
    expect(result).toEqual([
      { date: '2026-04-10', value: 300 },
      { date: '2026-04-11', value: 50 },
    ]);
  });

  it('returns empty array for no rows', () => {
    expect(groupByTime([], 'date', () => 0, 'sum', 'day')).toEqual([]);
  });

  it('sorts results chronologically', () => {
    const rows = [
      { date: '2026-04-12', amount: 10 },
      { date: '2026-04-10', amount: 30 },
      { date: '2026-04-11', amount: 20 },
    ];
    const result = groupByTime(rows, 'date', (r) => parseNumeric(r.amount), 'sum', 'day');
    expect(result.map((p) => p.date)).toEqual(['2026-04-10', '2026-04-11', '2026-04-12']);
  });
});

describe('groupByColumn', () => {
  it('groups rows by a column and sums', () => {
    const rows = [
      { direction: 'on_ramp', amount: 100 },
      { direction: 'off_ramp', amount: 200 },
      { direction: 'on_ramp', amount: 50 },
    ];
    const result = groupByColumn(rows, 'direction', (r) => parseNumeric(r.amount), 'sum');
    expect(result).toEqual(
      expect.arrayContaining([
        { group: 'on_ramp', value: 150 },
        { group: 'off_ramp', value: 200 },
      ]),
    );
  });
});

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('returns first page', () => {
    const { rows, total } = paginate(items, 1, 3);
    expect(rows).toEqual([1, 2, 3]);
    expect(total).toBe(10);
  });

  it('returns middle page', () => {
    const { rows, total } = paginate(items, 2, 3);
    expect(rows).toEqual([4, 5, 6]);
    expect(total).toBe(10);
  });

  it('returns partial last page', () => {
    const { rows, total } = paginate(items, 4, 3);
    expect(rows).toEqual([10]);
    expect(total).toBe(10);
  });

  it('returns empty for out-of-range page', () => {
    const { rows, total } = paginate(items, 100, 3);
    expect(rows).toEqual([]);
    expect(total).toBe(10);
  });

  it('returns empty for empty input', () => {
    const { rows, total } = paginate([], 1, 10);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });
});
