import type { ResolverContext, ViewResult } from '../types';
import { parseNumeric, round2, paginate } from '../utils';

/**
 * Bar chart: outstanding invoice amounts and counts by age bucket.
 * Buckets: 1-30d, 31-60d, 61-90d, 90+d (based on due_date age from now).
 */
export async function resolveInvoiceAging(ctx: ResolverContext): Promise<ViewResult> {
  const { data: invoices } = await ctx.supabase
    .from('invoices')
    .select('amount_usd, due_date, status')
    .eq('enterprise_id', ctx.enterpriseId)
    .in('status', ['unpaid', 'overdue']);

  const rows = (invoices ?? []) as Record<string, unknown>[];
  const now = new Date(ctx.to);

  const buckets: Record<string, { total: number; count: number }> = {
    '1-30d': { total: 0, count: 0 },
    '31-60d': { total: 0, count: 0 },
    '61-90d': { total: 0, count: 0 },
    '90+d': { total: 0, count: 0 },
  };

  for (const row of rows) {
    const dueDate = new Date(String(row.due_date));
    const ageDays = Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 86400000));
    let bucket: string;
    if (ageDays <= 30) bucket = '1-30d';
    else if (ageDays <= 60) bucket = '31-60d';
    else if (ageDays <= 90) bucket = '61-90d';
    else bucket = '90+d';

    buckets[bucket].total += parseNumeric(row.amount_usd);
    buckets[bucket].count += 1;
  }

  const bucketOrder = ['1-30d', '31-60d', '61-90d', '90+d'];

  return {
    view: { slug: 'invoice-aging', label: 'Invoice Aging', chartType: 'bar' },
    query: { from: ctx.from, to: ctx.to },
    groups: {
      invoice_outstanding_usd: bucketOrder.map((b) => ({
        group: b,
        value: round2(buckets[b].total),
      })),
      invoice_count: bucketOrder.map((b) => ({
        group: b,
        value: buckets[b].count,
      })),
    },
  };
}

/**
 * Table view: AI recommendations with optional status/action filters.
 * Returns paginated rows.
 */
export async function resolveAiActions(ctx: ResolverContext): Promise<ViewResult> {
  let query = ctx.supabase
    .from('ai_recommendations')
    .select('id, action_type, status, description, amount_usd, created_at')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('created_at', ctx.from)
    .lte('created_at', ctx.to + 'T23:59:59Z')
    .order('created_at', { ascending: false });

  if (ctx.filters.status) {
    const status = Array.isArray(ctx.filters.status) ? ctx.filters.status : [ctx.filters.status];
    query = query.in('status', status);
  }
  if (ctx.filters.action) {
    const action = Array.isArray(ctx.filters.action) ? ctx.filters.action : [ctx.filters.action];
    query = query.in('action_type', action);
  }

  const { data } = await query;
  const rows = (data ?? []) as Record<string, unknown>[];
  const { rows: paged, total } = paginate(rows, ctx.page, ctx.pageSize);

  return {
    view: { slug: 'ai-actions', label: 'AI Actions', chartType: 'table' },
    query: { from: ctx.from, to: ctx.to },
    rows: paged,
    total,
    page: ctx.page,
    pageSize: ctx.pageSize,
  };
}

/**
 * KPI view: compliance screening and alert metrics.
 */
export async function resolveComplianceSummary(ctx: ResolverContext): Promise<ViewResult> {
  const { data: screenings } = await ctx.supabase
    .from('sanctions_screenings')
    .select('result')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('created_at', ctx.from)
    .lte('created_at', ctx.to + 'T23:59:59Z');

  const { data: alerts } = await ctx.supabase
    .from('kyt_alerts')
    .select('status')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('created_at', ctx.from)
    .lte('created_at', ctx.to + 'T23:59:59Z');

  const screeningRows = (screenings ?? []) as Record<string, unknown>[];
  const alertRows = (alerts ?? []) as Record<string, unknown>[];

  const screeningCount = screeningRows.length;
  const screeningHitCount = screeningRows.filter((r) => r.result === 'hit').length;
  const kytAlertCount = alertRows.length;
  const kytOpenCount = alertRows.filter((r) => r.status === 'open').length;

  return {
    view: { slug: 'compliance-summary', label: 'Compliance Summary', chartType: 'kpi' },
    query: { from: ctx.from, to: ctx.to },
    scalar: {
      screening_count: screeningCount,
      screening_hit_count: screeningHitCount,
      kyt_alert_count: kytAlertCount,
      kyt_open_count: kytOpenCount,
    },
  };
}

/**
 * Table view: yield protocol transactions with optional protocol/status filters.
 * Returns paginated rows.
 */
export async function resolveYieldPerformance(ctx: ResolverContext): Promise<ViewResult> {
  let query = ctx.supabase
    .from('yield_transactions')
    .select('id, protocol, chain, tx_type, underlying_token, amount_usd, status, error_message, executed_at, tx_hash')
    .eq('enterprise_id', ctx.enterpriseId)
    .gte('executed_at', ctx.from)
    .lte('executed_at', ctx.to + 'T23:59:59Z')
    .order('executed_at', { ascending: false });

  if (ctx.filters.protocol) {
    const protocol = Array.isArray(ctx.filters.protocol) ? ctx.filters.protocol : [ctx.filters.protocol];
    query = query.in('protocol', protocol);
  }
  if (ctx.filters.status) {
    const status = Array.isArray(ctx.filters.status) ? ctx.filters.status : [ctx.filters.status];
    query = query.in('status', status);
  }

  const { data } = await query;
  const rows = (data ?? []) as Record<string, unknown>[];
  const { rows: paged, total } = paginate(rows, ctx.page, ctx.pageSize);

  return {
    view: { slug: 'yield-performance', label: 'Yield Performance', chartType: 'table' },
    query: { from: ctx.from, to: ctx.to },
    rows: paged,
    total,
    page: ctx.page,
    pageSize: ctx.pageSize,
  };
}
