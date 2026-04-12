import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByTime } from '../utils';

/**
 * Bar chart: obligation coverage over time.
 * Buckets obligations and fiat balance by granularity (default week).
 */
export async function resolveObligationCoverage(ctx: ResolverContext): Promise<ViewResult> {
  const granularity = ctx.granularity || 'week';

  const { data: obligations } = await ctx.supabase
    .from('outflow_obligations')
    .select('due_date, amount_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('due_date', ctx.from)
    .lte('due_date', ctx.to);

  const { data: snapshots } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select('snapshot_date, fiat_balance_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('snapshot_date', ctx.from)
    .lte('snapshot_date', ctx.to + 'T23:59:59Z')
    .order('snapshot_date', { ascending: true });

  const obRows = (obligations ?? []) as Record<string, unknown>[];
  const snapRows = (snapshots ?? []) as Record<string, unknown>[];

  const obligationSeries = groupByTime(
    obRows, 'due_date', (r) => parseNumeric(r.amount_usd), 'sum', granularity,
  );

  const fiatSeries = groupByTime(
    snapRows, 'snapshot_date', (r) => parseNumeric(r.fiat_balance_usd), 'latest', granularity,
  );

  // Build coverage ratio per bucket by matching dates
  const fiatMap = new Map(fiatSeries.map((p) => [p.date, p.value]));
  const coverageSeries = obligationSeries.map((ob) => {
    const fiat = fiatMap.get(ob.date) ?? 0;
    return { date: ob.date, value: ob.value > 0 ? round2(fiat / ob.value) : 0 };
  });

  return {
    view: { slug: 'obligation-coverage', label: 'Obligation Coverage', chartType: 'bar' },
    query: { from: ctx.from, to: ctx.to },
    groups: {
      obligation_total_usd: obligationSeries.map((p) => ({ group: p.date, value: p.value })),
      fiat_balance_usd: fiatSeries.map((p) => ({ group: p.date, value: p.value })),
      coverage_ratio: coverageSeries.map((p) => ({ group: p.date, value: p.value })),
    },
  };
}
