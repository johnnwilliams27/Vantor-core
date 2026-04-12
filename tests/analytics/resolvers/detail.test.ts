import { describe, it, expect } from 'vitest';
import type { ResolverContext } from '@/lib/analytics/types';
import {
  resolveInvoiceAging,
  resolveAiActions,
  resolveComplianceSummary,
  resolveYieldPerformance,
} from '@/lib/analytics/resolvers/detail';
import { mockSupabase } from './mock-supabase';

function baseCtx(supabase: any, overrides?: Partial<ResolverContext>): ResolverContext {
  return {
    supabase,
    enterpriseId: 'ent-1',
    from: '2026-03-01',
    to: '2026-04-10',
    filters: {},
    granularity: 'day',
    page: 1,
    pageSize: 25,
    ...overrides,
  };
}

describe('resolveInvoiceAging', () => {
  it('buckets invoices by age from ctx.to', async () => {
    // ctx.to = 2026-04-10
    const sb = mockSupabase({
      invoices: [
        { amount_usd: '1000', due_date: '2026-04-05', status: 'unpaid' },   // 5d → 1-30d
        { amount_usd: '2000', due_date: '2026-03-01', status: 'overdue' },  // 40d → 31-60d
        { amount_usd: '3000', due_date: '2026-01-05', status: 'overdue' },  // 95d → 90+d
      ],
    });

    const result = await resolveInvoiceAging(baseCtx(sb));
    expect(result.view.slug).toBe('invoice-aging');
    expect(result.view.chartType).toBe('bar');
    expect(result.groups).toBeDefined();

    const amounts = result.groups!.invoice_outstanding_usd;
    const counts = result.groups!.invoice_count;

    expect(amounts.find((g) => g.group === '1-30d')!.value).toBe(1000);
    expect(amounts.find((g) => g.group === '31-60d')!.value).toBe(2000);
    expect(amounts.find((g) => g.group === '90+d')!.value).toBe(3000);
    expect(counts.find((g) => g.group === '1-30d')!.value).toBe(1);
    expect(counts.find((g) => g.group === '31-60d')!.value).toBe(1);
    expect(counts.find((g) => g.group === '61-90d')!.value).toBe(0);
    expect(counts.find((g) => g.group === '90+d')!.value).toBe(1);
  });

  it('handles no invoices', async () => {
    const sb = mockSupabase({ invoices: [] });
    const result = await resolveInvoiceAging(baseCtx(sb));
    const amounts = result.groups!.invoice_outstanding_usd;
    for (const g of amounts) {
      expect(g.value).toBe(0);
    }
  });
});

describe('resolveAiActions', () => {
  it('returns paginated ai_recommendations', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `rec-${i}`,
      status: 'pending',
      action_type: 'rebalance',
      created_at: '2026-04-05T10:00:00Z',
    }));
    const sb = mockSupabase({ ai_recommendations: rows });
    const result = await resolveAiActions(baseCtx(sb, { page: 1, pageSize: 3 }));
    expect(result.view.slug).toBe('ai-actions');
    expect(result.rows).toHaveLength(3);
    expect(result.total).toBe(5);
  });
});

describe('resolveComplianceSummary', () => {
  it('computes screening and alert KPIs', async () => {
    const sb = mockSupabase({
      sanctions_screenings: [
        { result: 'clear' },
        { result: 'hit' },
        { result: 'clear' },
      ],
      kyt_alerts: [
        { status: 'open' },
        { status: 'resolved' },
        { status: 'open' },
      ],
    });

    const result = await resolveComplianceSummary(baseCtx(sb));
    expect(result.view.slug).toBe('compliance-summary');
    expect(result.view.chartType).toBe('kpi');
    expect(result.scalar!.screening_count).toBe(3);
    expect(result.scalar!.screening_hit_count).toBe(1);
    expect(result.scalar!.kyt_alert_count).toBe(3);
    expect(result.scalar!.kyt_open_count).toBe(2);
  });

  it('handles empty data', async () => {
    const sb = mockSupabase({
      sanctions_screenings: [],
      kyt_alerts: [],
    });
    const result = await resolveComplianceSummary(baseCtx(sb));
    expect(result.scalar!.screening_count).toBe(0);
    expect(result.scalar!.kyt_open_count).toBe(0);
  });
});

describe('resolveYieldPerformance', () => {
  it('returns paginated yield_transactions', async () => {
    const sb = mockSupabase({
      yield_transactions: [
        { id: 'y-1', protocol: 'aave', status: 'completed', amount_usd: '10000' },
        { id: 'y-2', protocol: 'compound', status: 'pending', amount_usd: '5000' },
      ],
    });
    const result = await resolveYieldPerformance(baseCtx(sb));
    expect(result.view.slug).toBe('yield-performance');
    expect(result.view.chartType).toBe('table');
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});
