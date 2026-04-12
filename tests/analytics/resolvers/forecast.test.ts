import { describe, it, expect } from 'vitest';
import type { ResolverContext } from '@/lib/analytics/types';
import { resolveForecastVsActuals } from '@/lib/analytics/resolvers/forecast';
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

describe('resolveForecastVsActuals', () => {
  it('returns forecast and actual series', async () => {
    const sb = mockSupabase({
      forecast_snapshots: [
        {
          projection: {
            daily: [
              { date: '2026-04-01', projected_balance_usd: 1000000 },
              { date: '2026-04-02', projected_balance_usd: 1010000 },
              { date: '2026-04-15', projected_balance_usd: 1100000 }, // outside window
            ],
          },
        },
      ],
      treasury_state_snapshots: [
        { snapshot_date: '2026-04-01T10:00:00Z', total_balance_usd: '995000' },
        { snapshot_date: '2026-04-02T10:00:00Z', total_balance_usd: '1005000' },
      ],
    });

    const result = await resolveForecastVsActuals(baseCtx(sb));
    expect(result.view.slug).toBe('forecast-vs-actuals');
    expect(result.view.chartType).toBe('line');
    expect(result.series).toBeDefined();
    // Only dates within window should appear in forecast series
    expect(result.series!.forecast_projected_usd).toHaveLength(2);
    expect(result.series!.total_balance_usd).toHaveLength(2);
    expect(result.series!.forecast_projected_usd[0].value).toBe(1000000);
    expect(result.series!.total_balance_usd[0].value).toBe(995000);
  });

  it('handles no forecast data', async () => {
    const sb = mockSupabase({
      forecast_snapshots: [],
      treasury_state_snapshots: [],
    });
    const result = await resolveForecastVsActuals(baseCtx(sb));
    expect(result.series!.forecast_projected_usd).toEqual([]);
    expect(result.series!.total_balance_usd).toEqual([]);
  });
});
