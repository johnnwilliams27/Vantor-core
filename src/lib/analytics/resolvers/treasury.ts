import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByTime } from '../utils';

/**
 * Shape of the per-row shim consumed by `groupByTime`. Built from the
 * canonical L3 leaves (Phase C-1.5a). Legacy `total_fiat_base_usd` is
 * still SELECTed as a NULL-fallback source for `cash_and_equivalents_usd`
 * on pre-migration snapshots — drop it once 0051 removes the columns.
 */
type EnrichedSnapshotRow = {
  taken_at: string;
  total_value_base_usd: number;
  total_bank_base_usd: number;
  total_stablecoin_idle_base_usd: number;
  total_mmf_base_usd: number;
  total_defi_vault_base_usd: number;
  total_defi_lending_base_usd: number;
  total_other_base_usd: number;
  // Computed rollups
  cash_and_equivalents_usd: number;
  defi_protocols_usd: number;
  yield_positions_usd: number;
} & Record<string, unknown>;

function enrich(r: Record<string, unknown>): EnrichedSnapshotRow {
  const bank = parseNumeric(r.total_bank_base_usd);
  const stable = parseNumeric(r.total_stablecoin_idle_base_usd);
  const mmf = parseNumeric(r.total_mmf_base_usd);
  const vault = parseNumeric(r.total_defi_vault_base_usd);
  const lending = parseNumeric(r.total_defi_lending_base_usd);
  // Pre-migration snapshot fallback: if the new leaves are NULL (0),
  // derive Cash & Equivalents from the legacy total_fiat_base_usd so
  // coverage views don't flash $0 on historical rows.
  const newLeafCash = bank + stable;
  const cashAndEquivalents = newLeafCash || parseNumeric(r.total_fiat_base_usd);
  return {
    taken_at: String(r.taken_at),
    total_value_base_usd: parseNumeric(r.total_value_base_usd),
    total_bank_base_usd: bank,
    total_stablecoin_idle_base_usd: stable,
    total_mmf_base_usd: mmf,
    total_defi_vault_base_usd: vault,
    total_defi_lending_base_usd: lending,
    total_other_base_usd: parseNumeric(r.total_other_base_usd),
    cash_and_equivalents_usd: cashAndEquivalents,
    defi_protocols_usd: vault + lending,
    yield_positions_usd: mmf + vault + lending,
  };
}

/**
 * KPI view: key treasury balance metrics.
 *
 * Fetches the latest treasury_state_snapshot as of `to` plus confirmed
 * outgoing obligations in the window. Emits scalars for the canonical
 * taxonomy (Phase C-1.5) — L1 rollups, L3 leaves, and derived coverage.
 *
 * Coverage ratio is Cash & Equivalents ÷ obligations (what the treasurer
 * can actually deploy to settle). `enrich()` handles the pre-migration
 * snapshot fallback so the scalar here is always populated.
 */
export async function resolveTreasurySummary(ctx: ResolverContext): Promise<ViewResult> {
  const { data: snapRow } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select(
      'taken_at, total_value_base_usd, total_fiat_base_usd, total_bank_base_usd, total_stablecoin_idle_base_usd, total_mmf_base_usd, total_defi_vault_base_usd, total_defi_lending_base_usd, total_other_base_usd',
    )
    .eq('enterprise_id', ctx.enterpriseId)
    .lte('taken_at', ctx.to + 'T23:59:59Z')
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: obligations } = await ctx.supabase
    .from('obligations')
    .select('amount_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .eq('direction', 'outflow')
    .eq('status', 'upcoming')
    .eq('is_active', true)
    .gte('due_date', ctx.from)
    .lte('due_date', ctx.to);

  const e = snapRow
    ? enrich(snapRow as Record<string, unknown>)
    : null;

  const cashAndEquivalents = e?.cash_and_equivalents_usd ?? 0;

  const obligationTotal = (obligations ?? []).reduce(
    (sum: number, o: Record<string, unknown>) => sum + parseNumeric(o.amount_usd),
    0,
  );
  const coverageRatio = obligationTotal > 0 ? cashAndEquivalents / obligationTotal : 0;
  const idleCash = cashAndEquivalents - obligationTotal;

  return {
    view: { slug: 'treasury-summary', label: 'Treasury Summary', chartType: 'kpi' },
    query: { from: ctx.from, to: ctx.to },
    scalar: {
      // Total + L1 rollups (primary KPI)
      total_balance_usd: round2(e?.total_value_base_usd ?? 0),
      cash_and_equivalents_usd: round2(cashAndEquivalents),
      yield_positions_usd: round2(e?.yield_positions_usd ?? 0),
      defi_protocols_usd: round2(e?.defi_protocols_usd ?? 0),
      // L3 leaves (detail)
      bank_balance_usd: round2(e?.total_bank_base_usd ?? 0),
      stablecoin_idle_balance_usd: round2(e?.total_stablecoin_idle_base_usd ?? 0),
      mmf_balance_usd: round2(e?.total_mmf_base_usd ?? 0),
      defi_vault_balance_usd: round2(e?.total_defi_vault_base_usd ?? 0),
      defi_lending_balance_usd: round2(e?.total_defi_lending_base_usd ?? 0),
      other_balance_usd: round2(e?.total_other_base_usd ?? 0),
      // Derived
      obligation_total_usd: round2(obligationTotal),
      idle_cash_usd: round2(idleCash),
      coverage_ratio: round2(coverageRatio),
    },
  };
}

/**
 * Line chart: treasury balance trends over time by taxonomy leaf.
 *
 * Returns every leaf + rollup series so the consumer's view config picks
 * whichever line set they want to display.
 */
export async function resolveBalanceHistory(ctx: ResolverContext): Promise<ViewResult> {
  const { data: snapshots } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select(
      'taken_at, total_value_base_usd, total_fiat_base_usd, total_bank_base_usd, total_stablecoin_idle_base_usd, total_mmf_base_usd, total_defi_vault_base_usd, total_defi_lending_base_usd, total_other_base_usd',
    )
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('taken_at', ctx.from)
    .lte('taken_at', ctx.to + 'T23:59:59Z')
    .order('taken_at', { ascending: true });

  const rows = ((snapshots ?? []) as Record<string, unknown>[]).map(enrich);

  // Helper to emit a series from a row accessor.
  const series = (pick: (r: EnrichedSnapshotRow) => number) =>
    groupByTime(rows, 'taken_at', pick, 'latest', ctx.granularity);

  return {
    view: { slug: 'balance-history', label: 'Balance History', chartType: 'line' },
    query: { from: ctx.from, to: ctx.to },
    series: {
      // L1 rollups
      cash_and_equivalents_usd: series((r) => r.cash_and_equivalents_usd),
      yield_positions_usd: series((r) => r.yield_positions_usd),
      defi_protocols_usd: series((r) => r.defi_protocols_usd),
      // L3 leaves
      bank_balance_usd: series((r) => r.total_bank_base_usd),
      stablecoin_idle_balance_usd: series((r) => r.total_stablecoin_idle_base_usd),
      mmf_balance_usd: series((r) => r.total_mmf_base_usd),
      defi_vault_balance_usd: series((r) => r.total_defi_vault_base_usd),
      defi_lending_balance_usd: series((r) => r.total_defi_lending_base_usd),
      other_balance_usd: series((r) => r.total_other_base_usd),
    },
  };
}

/**
 * Line chart: idle cash vs cash & equivalents over time.
 *
 * Idle cash = Cash & Equivalents at snapshot time - confirmed outflows in
 * the forward lookahead window (from treasury_rules, default 30 days).
 */
export async function resolveIdleCash(ctx: ResolverContext): Promise<ViewResult> {
  const { data: rules } = await ctx.supabase
    .from('treasury_rules')
    .select('obligation_lookahead_days')
    .eq('enterprise_id', ctx.enterpriseId)
    .limit(1)
    .maybeSingle();

  const lookaheadDays = parseNumeric(rules?.obligation_lookahead_days) || 30;

  const { data: snapshots } = await ctx.supabase
    .from('treasury_state_snapshots')
    .select(
      'taken_at, total_fiat_base_usd, total_bank_base_usd, total_stablecoin_idle_base_usd',
    )
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('taken_at', ctx.from)
    .lte('taken_at', ctx.to + 'T23:59:59Z')
    .order('taken_at', { ascending: true });

  const { data: obligations } = await ctx.supabase
    .from('obligations')
    .select('amount_usd, due_date')
    .eq('enterprise_id', ctx.enterpriseId)
    .eq('direction', 'outflow')
    .eq('status', 'upcoming')
    .eq('is_active', true);

  const obRows = (obligations ?? []) as Record<string, unknown>[];
  const snapRows = (snapshots ?? []) as Record<string, unknown>[];

  const enriched = snapRows.map((s) => {
    const snapDate = new Date(String(s.taken_at));
    const cutoff = new Date(snapDate.getTime() + lookaheadDays * 86_400_000);
    const obTotal = obRows
      .filter((o) => {
        const due = new Date(String(o.due_date));
        return due >= snapDate && due <= cutoff;
      })
      .reduce((sum, o) => sum + parseNumeric(o.amount_usd), 0);
    // Prefer new-taxonomy Cash & Equivalents; fall back to legacy fiat.
    const bank = parseNumeric(s.total_bank_base_usd);
    const stableIdle = parseNumeric(s.total_stablecoin_idle_base_usd);
    const cashAndEquivalents = bank + stableIdle || parseNumeric(s.total_fiat_base_usd);
    return {
      taken_at: String(s.taken_at),
      cash_and_equivalents_usd: cashAndEquivalents,
      idle_cash_usd: cashAndEquivalents - obTotal,
    };
  });

  return {
    view: { slug: 'idle-cash', label: 'Idle Cash', chartType: 'line' },
    query: { from: ctx.from, to: ctx.to },
    series: {
      idle_cash_usd: groupByTime(
        enriched,
        'taken_at',
        (r) => r.idle_cash_usd,
        'latest',
        ctx.granularity,
      ),
      cash_and_equivalents_usd: groupByTime(
        enriched,
        'taken_at',
        (r) => r.cash_and_equivalents_usd,
        'latest',
        ctx.granularity,
      ),
    },
  };
}
