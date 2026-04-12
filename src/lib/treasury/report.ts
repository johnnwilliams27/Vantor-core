import type { SupabaseClient } from '@supabase/supabase-js';
import type { AiRecommendation, FiatTransaction } from '@/types/database';

export interface ReportData {
  period: { from: string; to: string };
  summary: {
    avgBankBalanceUsd: number;
    avgCryptoBalanceUsd: number;
    totalOnrampUsd: number;
    totalOfframpUsd: number;
    netRampUsd: number;
    totalFeesUsd: number;
    recommendationCount: number;
    executedCount: number;
    avgObligationCoverageRatio: number;
  };
  balanceHistory: Array<{ date: string; bankUsd: number; cryptoUsd: number }>;
  recommendationOutcomes: AiRecommendation[];
  obligationCoverageByWeek: Array<{
    week: string;
    obligationsUsd: number;
    avgBankBalanceUsd: number;
    coverageRatio: number;
  }>;
  rampSummary: FiatTransaction[];
}

function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  // Return ISO week string (YYYY-Www)
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekNo = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * @deprecated Use the analytics engine via POST /api/analytics/query instead.
 * Kept temporarily for legacy callers. Will be removed in Phase C.
 */
export async function buildReportData(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<ReportData> {
  const fromIso = new Date(from + 'T00:00:00Z').toISOString();
  const toIso = new Date(to + 'T23:59:59Z').toISOString();

  // Parallel fetch of all needed data
  const [walletRes, recsRes, rampsRes, obligationsRes] = await Promise.all([
    // Wallet IDs for this user (to query balance_snapshots)
    supabase
      .from('wallets')
      .select('id')
      .eq('user_id', userId),
    // AI recommendations in period
    supabase
      .from('ai_recommendations')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .limit(500),
    // Fiat transactions in period
    supabase
      .from('fiat_transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: true })
      .limit(500),
    // Manual obligations in period (for weekly coverage).
    // Table renamed from manual_obligations → obligations in migration 0041.
    supabase
      .from('obligations')
      .select('due_date, amount_usd')
      .eq('user_id', userId)
      .eq('is_active', true)
      .gte('due_date', from)
      .lte('due_date', to),
  ]);

  const walletIds = (walletRes.data ?? []).map((w) => w.id as string);

  // Fetch balance snapshots for those wallets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshotData: any[] = [];
  if (walletIds.length > 0) {
    const res = await supabase
      .from('balance_snapshots')
      .select('wallet_id, token, balance, usd_value, snapped_at')
      .in('wallet_id', walletIds)
      .gte('snapped_at', fromIso)
      .lte('snapped_at', toIso)
      .order('snapped_at', { ascending: true })
      .limit(5000);
    snapshotData = res.data ?? [];
  }

  // Since we don't have bank snapshots directly, use ai_recommendations' stored balances as proxy
  const recs = (recsRes.data ?? []) as AiRecommendation[];

  // Build daily balance history from recommendation snapshots + crypto snapshots
  // Group crypto snapshots by day
  const cryptoByDay = new Map<string, number>();
  for (const snap of snapshotData) {
    const day = (snap.snapped_at as string).split('T')[0];
    const usdVal = snap.usd_value ? parseFloat(snap.usd_value as string) : 0;
    cryptoByDay.set(day, (cryptoByDay.get(day) ?? 0) + usdVal);
  }

  // Use recs to build bank balance history per day
  const bankByDay = new Map<string, number>();
  for (const rec of recs) {
    const day = rec.created_at.split('T')[0];
    bankByDay.set(day, parseFloat(rec.total_bank_balance_usd));
  }

  // Merge days — use Array.from to avoid MapIterator downlevel issues
  const allDays = new Set(Array.from(cryptoByDay.keys()).concat(Array.from(bankByDay.keys())));
  const balanceHistory = Array.from(allDays)
    .sort()
    .map((date) => ({
      date,
      bankUsd: Math.round((bankByDay.get(date) ?? 0) * 100) / 100,
      cryptoUsd: Math.round((cryptoByDay.get(date) ?? 0) * 100) / 100,
    }));

  // Summary computations
  const ramps = (rampsRes.data ?? []) as FiatTransaction[];
  const totalOnrampUsd = ramps
    .filter((r) => r.direction === 'onramp')
    .reduce((sum, r) => sum + parseFloat(r.fiat_amount), 0);
  const totalOfframpUsd = ramps
    .filter((r) => r.direction === 'offramp')
    .reduce((sum, r) => sum + parseFloat(r.fiat_amount), 0);
  const totalFeesUsd = ramps
    .filter((r) => r.fee_amount)
    .reduce((sum, r) => sum + parseFloat(r.fee_amount!), 0);

  const executedCount = recs.filter((r) =>
    ['executed', 'auto_executed'].includes(r.status)
  ).length;

  const avgBankBalanceUsd =
    balanceHistory.length > 0
      ? balanceHistory.reduce((sum, d) => sum + d.bankUsd, 0) / balanceHistory.length
      : 0;
  const avgCryptoBalanceUsd =
    balanceHistory.length > 0
      ? balanceHistory.reduce((sum, d) => sum + d.cryptoUsd, 0) / balanceHistory.length
      : 0;

  // Obligation coverage ratio: bank balance / obligations_in_window per recommendation
  const coverageRatios = recs
    .filter((r) => parseFloat(r.obligations_in_window_usd) > 0)
    .map((r) => parseFloat(r.total_bank_balance_usd) / parseFloat(r.obligations_in_window_usd));
  const avgObligationCoverageRatio =
    coverageRatios.length > 0
      ? coverageRatios.reduce((s, r) => s + r, 0) / coverageRatios.length
      : 0;

  // Weekly obligation coverage
  const weeklyObligations = new Map<string, number>();
  for (const ob of obligationsRes.data ?? []) {
    const week = isoWeek(ob.due_date as string);
    weeklyObligations.set(week, (weeklyObligations.get(week) ?? 0) + parseFloat(ob.amount_usd as string));
  }

  const weeklyBankBalance = new Map<string, { sum: number; count: number }>();
  for (const d of balanceHistory) {
    const week = isoWeek(d.date);
    const existing = weeklyBankBalance.get(week) ?? { sum: 0, count: 0 };
    weeklyBankBalance.set(week, { sum: existing.sum + d.bankUsd, count: existing.count + 1 });
  }

  const allWeeks = new Set(Array.from(weeklyObligations.keys()).concat(Array.from(weeklyBankBalance.keys())));
  const obligationCoverageByWeek = Array.from(allWeeks)
    .sort()
    .map((week) => {
      const obligationsUsd = weeklyObligations.get(week) ?? 0;
      const bankData = weeklyBankBalance.get(week);
      const avgBank = bankData ? bankData.sum / bankData.count : 0;
      const coverageRatio = obligationsUsd > 0 ? avgBank / obligationsUsd : 0;
      return {
        week,
        obligationsUsd: Math.round(obligationsUsd * 100) / 100,
        avgBankBalanceUsd: Math.round(avgBank * 100) / 100,
        coverageRatio: Math.round(coverageRatio * 100) / 100,
      };
    });

  return {
    period: { from, to },
    summary: {
      avgBankBalanceUsd: Math.round(avgBankBalanceUsd * 100) / 100,
      avgCryptoBalanceUsd: Math.round(avgCryptoBalanceUsd * 100) / 100,
      totalOnrampUsd: Math.round(totalOnrampUsd * 100) / 100,
      totalOfframpUsd: Math.round(totalOfframpUsd * 100) / 100,
      netRampUsd: Math.round((totalOnrampUsd - totalOfframpUsd) * 100) / 100,
      totalFeesUsd: Math.round(totalFeesUsd * 100) / 100,
      recommendationCount: recs.length,
      executedCount,
      avgObligationCoverageRatio: Math.round(avgObligationCoverageRatio * 100) / 100,
    },
    balanceHistory,
    recommendationOutcomes: recs,
    obligationCoverageByWeek,
    rampSummary: ramps,
  };
}

/** Guard against CSV injection (=, +, -, @) by prefixing with tab */
function csvSafeValue(val: unknown): string {
  const str = val === null || val === undefined ? '' : String(val);
  if (/^[=+\-@]/.test(str)) return `\t${str}`;
  return str;
}

function csvRow(values: unknown[]): string {
  return values.map((v) => `"${csvSafeValue(v).replace(/"/g, '""')}"`).join(',');
}

/** Serializes ReportData to a multi-section CSV string */
export function reportToCsv(data: ReportData): string {
  const sections: string[] = [];

  // Section 1: Balance History
  sections.push('# Balance History');
  sections.push(csvRow(['Date', 'Bank Balance (USD)', 'Crypto Balance (USD)']));
  for (const row of data.balanceHistory) {
    sections.push(csvRow([row.date, row.bankUsd, row.cryptoUsd]));
  }

  sections.push('');

  // Section 2: Recommendation Outcomes
  sections.push('# Recommendation Outcomes');
  sections.push(
    csvRow(['Date', 'Action', 'Recommended Amount (USD)', 'Status', 'Bank Balance (USD)', 'Obligations (USD)', 'AI Reasoning'])
  );
  for (const rec of data.recommendationOutcomes) {
    sections.push(
      csvRow([
        rec.created_at.split('T')[0],
        rec.action,
        rec.recommended_amount_usd ?? '',
        rec.status,
        rec.total_bank_balance_usd,
        rec.obligations_in_window_usd,
        rec.ai_reasoning.slice(0, 200),
      ])
    );
  }

  sections.push('');

  // Section 3: Ramp History
  sections.push('# Ramp History');
  sections.push(
    csvRow(['Date', 'Direction', 'Crypto Amount', 'Crypto Token', 'Fiat Amount', 'Fiat Currency', 'Fee', 'Status', 'Provider'])
  );
  for (const ramp of data.rampSummary) {
    sections.push(
      csvRow([
        ramp.created_at.split('T')[0],
        ramp.direction,
        ramp.crypto_amount,
        ramp.crypto_token,
        ramp.fiat_amount,
        ramp.fiat_currency,
        ramp.fee_amount ?? '',
        ramp.status,
        ramp.provider,
      ])
    );
  }

  return sections.join('\n');
}
