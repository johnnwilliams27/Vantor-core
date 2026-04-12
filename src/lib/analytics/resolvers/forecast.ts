import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByTime, toDay } from '../utils';

/**
 * Line chart: forecast projected balance vs actual treasury balance.
 * Fetches the most recent base-scenario non-hypothetical forecast_snapshot,
 * extracts projection.daily. Fetches actual treasury_state_snapshots.
 */
export async function resolveForecastVsActuals(ctx: ResolverContext): Promise<ViewResult> {
  // Get most recent non-hypothetical base-scenario forecast
  const { data: forecast } = await ctx.supabase
    .from('forecast_snapshots')
    .select('projection')
    .eq('enterprise_id', ctx.enterpriseId)
    .eq('scenario_type', 'base')
    .eq('is_hypothetical', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Get actual snapshots in window
  const { data: actuals } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select('snapshot_date, total_balance_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('snapshot_date', ctx.from)
    .lte('snapshot_date', ctx.to + 'T23:59:59Z')
    .order('snapshot_date', { ascending: true });

  const actualRows = (actuals ?? []) as Record<string, unknown>[];

  // Extract daily projections from forecast
  const projection = (forecast?.projection ?? {}) as Record<string, unknown>;
  const daily = (projection.daily ?? []) as Array<Record<string, unknown>>;

  // Filter daily projections to the query window and build rows
  const forecastRows = daily
    .filter((d) => {
      const date = toDay(String(d.date ?? ''));
      return date >= ctx.from && date <= ctx.to;
    })
    .map((d) => ({
      date: toDay(String(d.date ?? '')),
      projected_usd: parseNumeric(d.projected_balance_usd ?? d.balance_usd ?? d.value),
    }));

  const forecastSeries = groupByTime(
    forecastRows as unknown as Record<string, unknown>[],
    'date' as string,
    (r: Record<string, unknown>) => parseNumeric(r.projected_usd),
    'latest',
    ctx.granularity,
  );

  const actualSeries = groupByTime(
    actualRows,
    'snapshot_date',
    (r) => parseNumeric(r.total_balance_usd),
    'latest',
    ctx.granularity,
  );

  return {
    view: { slug: 'forecast-vs-actuals', label: 'Forecast vs Actuals', chartType: 'line' },
    query: { from: ctx.from, to: ctx.to },
    series: {
      forecast_projected_usd: forecastSeries,
      total_balance_usd: actualSeries,
    },
  };
}
