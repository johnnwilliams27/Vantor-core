import { describe, it, expect } from 'vitest';
import type { ResolverContext } from '@/lib/analytics/types';
import { resolveRampActivity, resolveTransferVolume, resolveSwapActivity } from '@/lib/analytics/resolvers/activity';
import { mockSupabase } from './mock-supabase';

function baseCtx(supabase: any, overrides?: Partial<ResolverContext>): ResolverContext {
  return {
    supabase,
    enterpriseId: 'ent-1',
    from: '2026-04-01',
    to: '2026-04-10',
    filters: {},
    granularity: 'day',
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

describe('resolveRampActivity', () => {
  it('groups fiat_transactions by direction', async () => {
    const sb = mockSupabase({
      fiat_transactions: [
        { direction: 'on_ramp', amount_usd: '10000', fee_usd: '50' },
        { direction: 'on_ramp', amount_usd: '20000', fee_usd: '100' },
        { direction: 'off_ramp', amount_usd: '5000', fee_usd: '25' },
      ],
    });

    const result = await resolveRampActivity(baseCtx(sb));
    expect(result.view.slug).toBe('ramp-activity');
    expect(result.view.chartType).toBe('bar');
    expect(result.groups).toBeDefined();

    const volGroups = result.groups!.ramp_volume_usd;
    const onRamp = volGroups.find((g) => g.group === 'on_ramp');
    const offRamp = volGroups.find((g) => g.group === 'off_ramp');
    expect(onRamp!.value).toBe(30000);
    expect(offRamp!.value).toBe(5000);

    const countGroups = result.groups!.ramp_count;
    expect(countGroups.find((g) => g.group === 'on_ramp')!.value).toBe(2);
    expect(countGroups.find((g) => g.group === 'off_ramp')!.value).toBe(1);

    const feeGroups = result.groups!.ramp_fee_usd;
    expect(feeGroups.find((g) => g.group === 'on_ramp')!.value).toBe(150);
  });

  it('handles empty data', async () => {
    const sb = mockSupabase({ fiat_transactions: [] });
    const result = await resolveRampActivity(baseCtx(sb));
    expect(result.groups!.ramp_volume_usd).toEqual([]);
  });
});

describe('resolveTransferVolume', () => {
  it('returns paginated transfer rows', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `t-${i}`,
      amount_usd: String(1000 + i),
      status: 'completed',
      chain: 'ethereum',
      created_at: '2026-04-05T10:00:00Z',
    }));

    const sb = mockSupabase({ transfers: rows });
    const result = await resolveTransferVolume(baseCtx(sb, { page: 1, pageSize: 10 }));
    expect(result.view.slug).toBe('transfer-volume');
    expect(result.view.chartType).toBe('table');
    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(30);
    expect(result.page).toBe(1);
  });

  it('respects page parameter', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `t-${i}` }));
    const sb = mockSupabase({ transfers: rows });
    const result = await resolveTransferVolume(baseCtx(sb, { page: 2, pageSize: 3 }));
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(5);
  });
});

describe('resolveSwapActivity', () => {
  it('returns paginated bridge_transfer rows', async () => {
    const sb = mockSupabase({
      bridge_transfers: [
        { id: 'b-1', chain: 'ethereum', status: 'completed' },
        { id: 'b-2', chain: 'solana', status: 'pending' },
      ],
    });
    const result = await resolveSwapActivity(baseCtx(sb));
    expect(result.view.slug).toBe('swap-activity');
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});
