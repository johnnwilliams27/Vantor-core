import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByTime } from '../utils';

/**
 * Bar chart: obligation coverage over time.
 *
 * Buckets outgoing obligations by due_date and compares against Cash &
 * Equivalents at each bucket. Coverage ratio = cash / obligations.
 *
 * Obligations are filtered to direction=outflow, status=upcoming, is_active=true
 * (matches the same semantics used by the rules engine and insights detectors).
 */
export async function resolveObligationCoverage(ctx: ResolverContext): Promise<ViewResult> {
  const granularity = ctx.granularity || 'week';

  const { data: obligations } = await ctx.supabase
    .from('obligations')
    .select('due_date, amount_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .eq('direction', 'outflow')
    .eq('status', 'upcoming')
    .eq('is_active', true)
    .gte('due_date', ctx.from)
    .lte('due_date', ctx.to);

  const { data: snapshots } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select(
      'taken_at, total_fiat_base_usd, total_bank_base_usd, total_stablecoin_idle_base_usd',
    )
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('taken_at', ctx.from)
    .lte('taken_at', ctx.to + 'T23:59:59Z')
    .order('taken_at', { ascending: true });

  const obRows = (obligations ?? []) as Record<string, unknown>[];
  const snapRows = (snapshots ?? []) as Record<string, unknown>[];

  // Cash & Equivalents per snapshot, with legacy fallback when new leaves
  // are NULL (pre-C-1.5 snapshots).
  const cashRows = snapRows.map((s) => {
    const bank = parseNumeric(s.total_bank_base_usd);
    const stableIdle = parseNumeric(s.total_stablecoin_idle_base_usd);
    const cashAndEquivalents = bank + stableIdle || parseNumeric(s.total_fiat_base_usd);
    return { taken_at: String(s.taken_at), cash_and_equivalents_usd: cashAndEquivalents };
  });

  const obligationSeries = groupByTime(
    obRows,
    'due_date',
    (r) => parseNumeric(r.amount_usd),
    'sum',
    granularity,
  );

  const cashSeries = groupByTime(
    cashRows,
    'taken_at',
    (r) => r.cash_and_equivalents_usd,
    'latest',
    granularity,
  );

  const cashMap = new Map(cashSeries.map((p) => [p.date, p.value]));
  const coverageSeries = obligationSeries.map((ob) => {
    const cash = cashMap.get(ob.date) ?? 0;
    return { date: ob.date, value: ob.value > 0 ? round2(cash / ob.value) : 0 };
  });

  return {
    view: { slug: 'obligation-coverage', label: 'Obligation Coverage', chartType: 'bar' },
    query: { from: ctx.from, to: ctx.to },
    groups: {
      obligation_total_usd: obligationSeries.map((p) => ({ group: p.date, value: p.value })),
      cash_and_equivalents_usd: cashSeries.map((p) => ({ group: p.date, value: p.value })),
      coverage_ratio: coverageSeries.map((p) => ({ group: p.date, value: p.value })),
    },
  };
}
