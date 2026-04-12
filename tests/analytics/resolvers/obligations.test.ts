import { describe, it, expect } from 'vitest';
import type { ResolverContext } from '@/lib/analytics/types';
import { resolveObligationCoverage } from '@/lib/analytics/resolvers/obligations';
import { mockSupabase } from './mock-supabase';

function baseCtx(supabase: any): ResolverContext {
  return {
    supabase,
    enterpriseId: 'ent-1',
    from: '2026-04-01',
    to: '2026-04-30',
    filters: {},
    granularity: 'week',
    page: 1,
    pageSize: 25,
  };
}

describe('resolveObligationCoverage', () => {
  it('returns obligation + cash & equivalents + coverage groups by week', async () => {
    const sb = mockSupabase({
      obligations: [
        { due_date: '2026-04-07', amount_usd: '100000' },
        { due_date: '2026-04-08', amount_usd: '50000' },
        { due_date: '2026-04-14', amount_usd: '75000' },
      ],
      treasury_state_snapshots: [
        {
          taken_at: '2026-04-07T10:00:00Z',
          total_fiat_base_usd: '0',
          total_bank_base_usd: '150000',
          total_stablecoin_idle_base_usd: '50000',
        },
        {
          taken_at: '2026-04-14T10:00:00Z',
          total_fiat_base_usd: '0',
          total_bank_base_usd: '130000',
          total_stablecoin_idle_base_usd: '50000',
        },
      ],
    });

    const result = await resolveObligationCoverage(baseCtx(sb));
    expect(result.view.slug).toBe('obligation-coverage');
    expect(result.view.chartType).toBe('bar');
    expect(result.groups).toBeDefined();
    expect(result.groups!.obligation_total_usd.length).toBeGreaterThan(0);
    expect(result.groups!.cash_and_equivalents_usd.length).toBeGreaterThan(0);
    expect(result.groups!.coverage_ratio.length).toBeGreaterThan(0);
  });

  it('handles empty data', async () => {
    const sb = mockSupabase({
      obligations: [],
      treasury_state_snapshots: [],
    });
    const result = await resolveObligationCoverage(baseCtx(sb));
    expect(result.groups!.obligation_total_usd).toEqual([]);
  });
});
