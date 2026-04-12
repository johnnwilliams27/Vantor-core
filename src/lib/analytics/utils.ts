import type { Aggregation, TimeGranularity, TimeSeriesPoint, GroupedPoint } from './types';

/** Parse a DB value (string | number | null | undefined) to a finite number, NaN → 0. */
export function parseNumeric(val: unknown): number {
  if (val == null) return 0;
  const n = typeof val === 'number' ? val : Number(val);
  return Number.isFinite(n) ? n : 0;
}

/** Apply an aggregation function to an array of numbers. Empty array → 0. */
export function aggregateValues(values: number[], agg: Aggregation): number {
  if (values.length === 0) return 0;
  switch (agg) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'count':
      return values.length;
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'latest':
      return values[values.length - 1];
    default:
      return 0;
  }
}

/** Round to 2 decimal places. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Extract YYYY-MM-DD from an ISO date string. */
export function toDay(dateStr: string): string {
  return dateStr.slice(0, 10);
}

/** Return ISO week string "YYYY-Www" for the given date string. */
export function isoWeek(dateStr: string): string {
  const d = new Date(dateStr);
  // Set to nearest Thursday (ISO week algorithm)
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Return "YYYY-MM" for the given date string. */
export function isoMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * Group rows into time-series points.
 * @param rows - DB result rows
 * @param dateColumn - key on each row containing the date string
 * @param getValue - extract numeric value from a row
 * @param agg - aggregation to apply within each bucket
 * @param granularity - day | week | month
 */
export function groupByTime<T extends Record<string, unknown>>(
  rows: T[],
  dateColumn: keyof T & string,
  getValue: (row: T) => number,
  agg: Aggregation,
  granularity: TimeGranularity,
): TimeSeriesPoint[] {
  const bucketFn =
    granularity === 'week' ? isoWeek : granularity === 'month' ? isoMonth : toDay;

  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const dateVal = String(row[dateColumn] ?? '');
    const key = bucketFn(dateVal);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(getValue(row));
  }

  const result: TimeSeriesPoint[] = [];
  for (const [date, values] of Array.from(buckets)) {
    result.push({ date, value: round2(aggregateValues(values, agg)) });
  }
  result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return result;
}

/**
 * Group rows by a categorical column.
 */
export function groupByColumn<T extends Record<string, unknown>>(
  rows: T[],
  column: keyof T & string,
  getValue: (row: T) => number,
  agg: Aggregation,
): GroupedPoint[] {
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[column] ?? 'unknown');
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(getValue(row));
  }

  const result: GroupedPoint[] = [];
  for (const [group, values] of Array.from(buckets)) {
    result.push({ group, value: round2(aggregateValues(values, agg)) });
  }
  return result;
}

/**
 * Paginate an array. Page is 1-based.
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { rows: T[]; total: number } {
  const total = items.length;
  const start = (page - 1) * pageSize;
  const rows = items.slice(start, start + pageSize);
  return { rows, total };
}
