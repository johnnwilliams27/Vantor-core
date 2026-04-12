import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByTime } from '../utils';

/**
 * KPI view: key treasury balance metrics.
 * Fetches latest treasury_state_snapshots row + confirmed outflow obligations.
 */
export async function resolveTreasurySummary(ctx: ResolverContext): Promise<ViewResult> {
  const { data: snapshot } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select('*')
    .eq('enterprise_id', ctx.enterpriseId)
    .lte('snapshot_date', ctx.to)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single();

  const { data: obligations } = await ctx.supabase
    .from('outflow_obligations')
    .select('amount_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .eq('status', 'confirmed');

  const totalBalance = parseNumeric(snapshot?.total_balance_usd);
  const fiatBalance = parseNumeric(snapshot?.fiat_balance_usd);
  const stablecoinBalance = parseNumeric(snapshot?.stablecoin_balance_usd);
  const defiBalance = parseNumeric(snapshot?.defi_balance_usd);
  const obligationTotal = (obligations ?? []).reduce(
    (sum: number, o: Record<string, unknown>) => sum + parseNumeric(o.amount_usd),
    0,
  );
  const idleCash = stablecoinBalance - obligationTotal;
  const coverageRatio = obligationTotal > 0 ? fiatBalance / obligationTotal : 0;

  return {
    view: { slug: 'treasury-summary', label: 'Treasury Summary', chartType: 'kpi' },
    query: { from: ctx.from, to: ctx.to },
    scalar: {
      total_balance_usd: round2(totalBalance),
      fiat_balance_usd: round2(fiatBalance),
      stablecoin_balance_usd: round2(stablecoinBalance),
      defi_balance_usd: round2(defiBalance),
      idle_cash_usd: round2(idleCash),
      coverage_ratio: round2(coverageRatio),
    },
  };
}

/**
 * Line chart: treasury balance trends over time by asset type.
 * Uses 'latest' aggregation within each time bucket.
 */
export async function resolveBalanceHistory(ctx: ResolverContext): Promise<ViewResult> {
  const { data: snapshots } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select('snapshot_date, fiat_balance_usd, stablecoin_balance_usd, defi_balance_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('snapshot_date', ctx.from)
    .lte('snapshot_date', ctx.to + 'T23:59:59Z')
    .order('snapshot_date', { ascending: true });

  const rows = (snapshots ?? []) as Record<string, unknown>[];

  return {
    view: { slug: 'balance-history', label: 'Balance History', chartType: 'line' },
    query: { from: ctx.from, to: ctx.to },
    series: {
      fiat_balance_usd: groupByTime(
        rows, 'snapshot_date', (r) => parseNumeric(r.fiat_balance_usd), 'latest', ctx.granularity,
      ),
      stablecoin_balance_usd: groupByTime(
        rows, 'snapshot_date', (r) => parseNumeric(r.stablecoin_balance_usd), 'latest', ctx.granularity,
      ),
      defi_balance_usd: groupByTime(
        rows, 'snapshot_date', (r) => parseNumeric(r.defi_balance_usd), 'latest', ctx.granularity,
      ),
    },
  };
}

/**
 * Line chart: idle cash vs stablecoin balance over time.
 * For each snapshot: idle = stablecoin_balance - confirmed outflows within lookahead days.
 */
export async function resolveIdleCash(ctx: ResolverContext): Promise<ViewResult> {
  // Fetch treasury rules for obligation_lookahead_days
  const { data: rules } = await ctx.supabase
    .from('treasury_rules')
    .select('obligation_lookahead_days')
    .eq('enterprise_id', ctx.enterpriseId)
    .limit(1)
    .single();

  const lookaheadDays = parseNumeric(rules?.obligation_lookahead_days) || 30;

  const { data: snapshots } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select('snapshot_date, stablecoin_balance_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('snapshot_date', ctx.from)
    .lte('snapshot_date', ctx.to + 'T23:59:59Z')
    .order('snapshot_date', { ascending: true });

  const { data: obligations } = await ctx.supabase
    .from('outflow_obligations')
    .select('amount_usd, due_date')
    .eq('enterprise_id', ctx.enterpriseId)
    .eq('status', 'confirmed');

  const obRows = (obligations ?? []) as Record<string, unknown>[];
  const snapRows = (snapshots ?? []) as Record<string, unknown>[];

  // For each snapshot, compute idle cash by subtracting obligations
  // within lookahead days of that snapshot's date
  const enriched = snapRows.map((s) => {
    const snapDate = new Date(String(s.snapshot_date));
    const cutoff = new Date(snapDate.getTime() + lookaheadDays * 86400000);
    const obTotal = obRows
      .filter((o) => {
        const due = new Date(String(o.due_date));
        return due >= snapDate && due <= cutoff;
      })
      .reduce((sum, o) => sum + parseNumeric(o.amount_usd), 0);
    const stablecoin = parseNumeric(s.stablecoin_balance_usd);
    return {
      snapshot_date: String(s.snapshot_date),
      stablecoin_balance_usd: stablecoin,
      idle_cash_usd: stablecoin - obTotal,
    };
  });

  return {
    view: { slug: 'idle-cash', label: 'Idle Cash', chartType: 'line' },
    query: { from: ctx.from, to: ctx.to },
    series: {
      idle_cash_usd: groupByTime(
        enriched, 'snapshot_date', (r) => r.idle_cash_usd, 'latest', ctx.granularity,
      ),
      stablecoin_balance_usd: groupByTime(
        enriched, 'snapshot_date', (r) => r.stablecoin_balance_usd, 'latest', ctx.granularity,
      ),
    },
  };
}
