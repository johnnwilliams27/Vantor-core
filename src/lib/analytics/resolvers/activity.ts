import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, groupByColumn, paginate } from '../utils';

/**
 * Bar chart: ramp activity by direction (on_ramp / off_ramp).
 * Groups fiat_transactions by direction.
 */
export async function resolveRampActivity(ctx: ResolverContext): Promise<ViewResult> {
  const { data: txns } = await ctx.supabase
    .from('fiat_transactions')
    .select('direction, amount_usd, fee_usd')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('created_at', ctx.from)
    .lte('created_at', ctx.to + 'T23:59:59Z');

  const rows = (txns ?? []) as Record<string, unknown>[];

  return {
    view: { slug: 'ramp-activity', label: 'Ramp Activity', chartType: 'bar' },
    query: { from: ctx.from, to: ctx.to },
    groups: {
      ramp_volume_usd: groupByColumn(rows, 'direction', (r) => parseNumeric(r.amount_usd), 'sum'),
      ramp_count: groupByColumn(rows, 'direction', () => 1, 'sum'),
      ramp_fee_usd: groupByColumn(rows, 'direction', (r) => parseNumeric(r.fee_usd), 'sum'),
    },
  };
}

/**
 * Table view: stablecoin transfers with optional status/chain filters.
 * Returns paginated rows.
 */
export async function resolveTransferVolume(ctx: ResolverContext): Promise<ViewResult> {
  let query = ctx.supabase
    .from('transfers')
    .select('id, wallet_id, chain, amount_usd, status, tx_hash, created_at, direction, from_address, to_address')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('created_at', ctx.from)
    .lte('created_at', ctx.to + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  if (ctx.filters.status) {
    const status = Array.isArray(ctx.filters.status) ? ctx.filters.status : [ctx.filters.status];
    query = query.in('status', status);
  }
  if (ctx.filters.chain) {
    const chain = Array.isArray(ctx.filters.chain) ? ctx.filters.chain : [ctx.filters.chain];
    query = query.in('chain', chain);
  }

  const { data } = await query;
  const rows = (data ?? []) as Record<string, unknown>[];
  const { rows: paged, total } = paginate(rows, ctx.page, ctx.pageSize);

  return {
    view: { slug: 'transfer-volume', label: 'Transfer Volume', chartType: 'table' },
    query: { from: ctx.from, to: ctx.to },
    rows: paged,
    total,
    page: ctx.page,
    pageSize: ctx.pageSize,
  };
}

/**
 * Table view: bridge/swap transactions with optional chain/status filters.
 * Returns paginated rows.
 */
export async function resolveSwapActivity(ctx: ResolverContext): Promise<ViewResult> {
  let query = ctx.supabase
    .from('bridge_transfers')
    .select('id, wallet_id, source_chain, destination_chain, token_in, token_out, amount_usd, status, tx_hash, created_at')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('created_at', ctx.from)
    .lte('created_at', ctx.to + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  if (ctx.filters.status) {
    const status = Array.isArray(ctx.filters.status) ? ctx.filters.status : [ctx.filters.status];
    query = query.in('status', status);
  }
  if (ctx.filters.chain) {
    const chain = Array.isArray(ctx.filters.chain) ? ctx.filters.chain : [ctx.filters.chain];
    query = query.in('source_chain', chain).in('destination_chain', chain);
  }

  const { data } = await query;
  const rows = (data ?? []) as Record<string, unknown>[];
  const { rows: paged, total } = paginate(rows, ctx.page, ctx.pageSize);

  return {
    view: { slug: 'swap-activity', label: 'Swap Activity', chartType: 'table' },
    query: { from: ctx.from, to: ctx.to },
    rows: paged,
    total,
    page: ctx.page,
    pageSize: ctx.pageSize,
  };
}
