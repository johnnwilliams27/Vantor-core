import { describe, it, expect } from 'vitest';
import type { ResolverContext } from '@/lib/analytics/types';
import { resolveTreasurySummary, resolveBalanceHistory, resolveIdleCash } from '@/lib/analytics/resolvers/treasury';
import { mockSupabase } from './mock-supabase';

function baseCtx(supabase: any): ResolverContext {
  return {
    supabase,
    enterpriseId: 'ent-1',
    from: '2026-04-01',
    to: '2026-04-10',
    filters: {},
    granularity: 'day',
    page: 1,
    pageSize: 25,
  };
}

describe('resolveTreasurySummary', () => {
  it('computes KPI scalars from snapshot + obligations', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        {
          snapshot_date: '2026-04-10',
          total_balance_usd: '1000000',
          fiat_balance_usd: '400000',
          stablecoin_balance_usd: '500000',
          defi_balance_usd: '100000',
        },
      ],
      outflow_obligations: [
        { amount_usd: '100000' },
        { amount_usd: '50000' },
      ],
    });

    const result = await resolveTreasurySummary(baseCtx(sb));
    expect(result.view.slug).toBe('treasury-summary');
    expect(result.view.chartType).toBe('kpi');
    expect(result.scalar).toBeDefined();
    expect(result.scalar!.total_balance_usd).toBe(1000000);
    expect(result.scalar!.fiat_balance_usd).toBe(400000);
    expect(result.scalar!.stablecoin_balance_usd).toBe(500000);
    expect(result.scalar!.defi_balance_usd).toBe(100000);
    expect(result.scalar!.idle_cash_usd).toBe(350000); // 500k - 150k
    expect(result.scalar!.coverage_ratio).toBe(2.67); // 400k / 150k
  });

  it('handles no snapshot', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [],
      outflow_obligations: [],
    });
    const result = await resolveTreasurySummary(baseCtx(sb));
    expect(result.scalar!.total_balance_usd).toBe(0);
    expect(result.scalar!.coverage_ratio).toBe(0);
  });
});

describe('resolveBalanceHistory', () => {
  it('returns 3 series grouped by day', async () => {
    const sb = mockSupabase({
      treasury_state_snapshots: [
        { snapshot_date: '2026-04-01T10:00:00Z', fiat_balance_usd: '100', stablecoin_balance_usd: '200', defi_balance_usd: '50' },
        { snapshot_date: '2026-04-02T10:00:00Z', fiat_balance_usd: '110', stablecoin_balance_usd: '210', defi_balance_usd: '55' },
      ],
    });

    const result = await resolveBalanceHistory(baseCtx(sb));
    expect(result.view.slug).toBe('balance-history');
    expect(result.view.chartType).toBe('line');
    expect(result.series).toBeDefined();
    expect(result.series!.fiat_balance_usd).toHaveLength(2);
    expect(result.series!.fiat_balance_usd[0]).toEqual({ date: '2026-04-01', value: 100 });
    expect(result.series!.stablecoin_balance_usd[1]).toEqual({ date: '2026-04-02', value: 210 });
  });

  it('handles empty data', async () => {
    const sb = mockSupabase({ treasury_state_snapshots: [] });
    const result = await resolveBalanceHistory(baseCtx(sb));
    expect(result.series!.fiat_balance_usd).toEqual([]);
  });
});

describe('resolveIdleCash', () => {
  it('computes idle cash by subtracting obligations within lookahead', async () => {
    const sb = mockSupabase({
      treasury_rules: [{ obligation_lookahead_days: 30 }],
      treasury_state_snapshots: [
        { snapshot_date: '2026-04-01T00:00:00Z', stablecoin_balance_usd: '500000' },
        { snapshot_date: '2026-04-05T00:00:00Z', stablecoin_balance_usd: '600000' },
      ],
      outflow_obligations: [
        { amount_usd: '100000', due_date: '2026-04-10' },
        { amount_usd: '50000', due_date: '2026-06-01' }, // beyond lookahead
      ],
    });

    const result = await resolveIdleCash(baseCtx(sb));
    expect(result.view.slug).toBe('idle-cash');
    expect(result.series).toBeDefined();
    // Both snapshots should include the 100k obligation (within 30d)
    // but not the 50k (June 1 is beyond 30d from both April dates)
    expect(result.series!.idle_cash_usd).toHaveLength(2);
    expect(result.series!.idle_cash_usd[0].value).toBe(400000); // 500k - 100k
    expect(result.series!.idle_cash_usd[1].value).toBe(500000); // 600k - 100k
  });
});
