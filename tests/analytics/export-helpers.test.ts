import { describe, it, expect } from 'vitest';
import { viewResultToCsvColumns, viewResultToCsvRows } from '@/components/analytics/export-helpers';
import type { ViewResult } from '@/lib/analytics/types';

describe('viewResultToCsvColumns (kpi)', () => {
  const kpiResult: ViewResult = {
    view: { slug: 'treasury-summary', label: 'Treasury Summary', chartType: 'kpi' },
    query: { from: '2026-04-01', to: '2026-04-30' },
    scalar: { total_balance_usd: 2400000, fiat_balance_usd: 1200000, idle_cash_usd: 320000 },
  };

  it('produces one column per scalar key', () => {
    const cols = viewResultToCsvColumns(kpiResult);
    expect(cols).toHaveLength(3);
    expect(cols[0].header).toBe('total_balance_usd');
  });

  it('produces a single row with the scalar values', () => {
    const rows = viewResultToCsvRows(kpiResult);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_balance_usd).toBe(2400000);
  });
});

describe('viewResultToCsvColumns (line)', () => {
  const lineResult: ViewResult = {
    view: { slug: 'balance-history', label: 'Balance History', chartType: 'line' },
    query: { from: '2026-04-01', to: '2026-04-10' },
    series: {
      fiat_balance_usd: [
        { date: '2026-04-01', value: 500000 },
        { date: '2026-04-02', value: 510000 },
      ],
      stablecoin_balance_usd: [
        { date: '2026-04-01', value: 200000 },
        { date: '2026-04-02', value: 195000 },
      ],
    },
  };

  it('produces date + one column per series', () => {
    const cols = viewResultToCsvColumns(lineResult);
    expect(cols[0].header).toBe('Date');
    expect(cols[1].header).toBe('fiat_balance_usd');
    expect(cols[2].header).toBe('stablecoin_balance_usd');
  });

  it('produces one row per date', () => {
    const rows = viewResultToCsvRows(lineResult);
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-04-01');
    expect(rows[0].fiat_balance_usd).toBe(500000);
  });
});

describe('viewResultToCsvColumns (bar)', () => {
  const barResult: ViewResult = {
    view: { slug: 'ramp-activity', label: 'Ramp Activity', chartType: 'bar' },
    query: { from: '2026-04-01', to: '2026-04-30' },
    groups: {
      ramp_volume_usd: [
        { group: 'onramp', value: 70000 },
        { group: 'offramp', value: 30000 },
      ],
      ramp_count: [
        { group: 'onramp', value: 5 },
        { group: 'offramp', value: 3 },
      ],
    },
  };

  it('produces group + one column per grouped measure', () => {
    const cols = viewResultToCsvColumns(barResult);
    expect(cols[0].header).toBe('Group');
    expect(cols[1].header).toBe('ramp_volume_usd');
  });

  it('produces one row per group', () => {
    const rows = viewResultToCsvRows(barResult);
    expect(rows).toHaveLength(2);
    expect(rows[0].group).toBe('onramp');
    expect(rows[0].ramp_volume_usd).toBe(70000);
  });
});

describe('viewResultToCsvColumns (table)', () => {
  const tableResult: ViewResult = {
    view: { slug: 'transfer-volume', label: 'Transfer Volume', chartType: 'table' },
    query: { from: '2026-04-01', to: '2026-04-30' },
    rows: [
      { id: 't1', created_at: '2026-04-10T00:00:00Z', amount_usd: 1000, status: 'completed', chain: 'ethereum' },
      { id: 't2', created_at: '2026-04-11T00:00:00Z', amount_usd: 2000, status: 'pending', chain: 'solana' },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  };

  it('produces one column per row key', () => {
    const cols = viewResultToCsvColumns(tableResult);
    expect(cols.map((c) => c.header)).toContain('id');
    expect(cols.map((c) => c.header)).toContain('amount_usd');
  });

  it('returns the rows as-is', () => {
    const rows = viewResultToCsvRows(tableResult);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('t1');
  });
});
