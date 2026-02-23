import type { SupabaseClient } from '@supabase/supabase-js';
import type { ForecastDataPoint } from '@/types/database';

interface ExpandedObligation {
  date: string;
  amountUsd: number;
  label: string;
}

/**
 * Projects recurring obligations forward by their recurrence_days interval
 * from today through the end of the lookahead window.
 * Also includes one-time obligations falling within the window.
 */
function expandRecurringObligations(
  obligations: Array<{
    id: string;
    label: string;
    amount_usd: string;
    due_date: string;
    is_recurring: boolean;
    recurrence_days: number | null;
  }>,
  from: Date,
  to: Date
): ExpandedObligation[] {
  const expanded: ExpandedObligation[] = [];
  const fromTime = from.getTime();
  const toTime = to.getTime();

  for (const ob of obligations) {
    const amountUsd = parseFloat(ob.amount_usd);
    const baseDate = new Date(ob.due_date + 'T00:00:00Z');

    if (!ob.is_recurring || !ob.recurrence_days) {
      // One-time obligation — include if within window
      const dateTime = baseDate.getTime();
      if (dateTime >= fromTime && dateTime <= toTime) {
        expanded.push({
          date: ob.due_date,
          amountUsd,
          label: ob.label,
        });
      }
      continue;
    }

    // Recurring: project forward from baseDate
    const intervalMs = ob.recurrence_days * 24 * 60 * 60 * 1000;
    let current = new Date(baseDate);

    // Advance past dates before `from` window
    while (current.getTime() < fromTime) {
      current = new Date(current.getTime() + intervalMs);
    }

    // Emit all occurrences within window
    while (current.getTime() <= toTime) {
      expanded.push({
        date: current.toISOString().split('T')[0],
        amountUsd,
        label: ob.label,
      });
      current = new Date(current.getTime() + intervalMs);
    }
  }

  return expanded;
}

/**
 * Computes the average daily net fiat inflow from the past 90 days.
 * onramp transactions are positive, offramp are negative.
 */
async function computeAverageDailyRampInflow(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const { data, error } = await supabase
    .from('fiat_transactions')
    .select('direction, fiat_amount, created_at')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .gte('created_at', ninetyDaysAgo.toISOString());

  if (error || !data || data.length === 0) return 0;

  // Sum net over the 90-day window
  let netTotal = 0;
  for (const tx of data) {
    const amount = parseFloat(tx.fiat_amount as string);
    netTotal += tx.direction === 'onramp' ? amount : -amount;
  }

  // Divide by 90 days to get daily average
  return netTotal / 90;
}

/**
 * Generates a day-by-day cash flow forecast from today through today+lookaheadDays.
 * Projects bank balance considering obligations and average daily ramp inflow.
 */
export async function generateCashFlowForecast(
  supabase: SupabaseClient,
  userId: string,
  lookaheadDays: number
): Promise<ForecastDataPoint[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);

  // Fetch ALL active manual obligations (no date filter — expand recurring ones ourselves)
  const [obligationRes, invoiceRes, bankRes, avgDailyRamp] = await Promise.all([
    supabase
      .from('manual_obligations')
      .select('id, label, amount_usd, due_date, is_recurring, recurrence_days')
      .eq('user_id', userId)
      .eq('is_active', true),
    supabase
      .from('invoices')
      .select('id, invoice_number, description, amount, due_date')
      .eq('user_id', userId)
      .in('status', ['unpaid', 'overdue'])
      .not('due_date', 'is', null),
    supabase
      .from('bank_accounts')
      .select('current_balance')
      .eq('user_id', userId)
      .eq('is_active', true),
    computeAverageDailyRampInflow(supabase, userId),
  ]);

  // Starting bank balance
  const startingBalance = (bankRes.data ?? []).reduce((sum, acct) => {
    return sum + (acct.current_balance ? parseFloat(acct.current_balance as string) : 0);
  }, 0);

  // Normalize manual obligations for expansion
  const manualObligations = (obligationRes.data ?? []).map((ob) => ({
    id: ob.id as string,
    label: ob.label as string,
    amount_usd: ob.amount_usd as string,
    due_date: ob.due_date as string,
    is_recurring: ob.is_recurring as boolean,
    recurrence_days: ob.recurrence_days as number | null,
  }));

  // Normalize invoices as non-recurring obligations
  const invoiceObligations = (invoiceRes.data ?? [])
    .filter((inv) => inv.due_date)
    .map((inv) => ({
      id: inv.id as string,
      label: (inv.description as string) || `Invoice ${inv.invoice_number}`,
      amount_usd: inv.amount as string,
      due_date: inv.due_date as string,
      is_recurring: false,
      recurrence_days: null,
    }));

  const allObligations = [...manualObligations, ...invoiceObligations];
  const expanded = expandRecurringObligations(allObligations, today, windowEnd);

  // Group obligations by date for fast lookup
  const obligationsByDate = new Map<string, Array<{ amountUsd: number; label: string }>>();
  for (const ob of expanded) {
    const existing = obligationsByDate.get(ob.date) ?? [];
    existing.push({ amountUsd: ob.amountUsd, label: ob.label });
    obligationsByDate.set(ob.date, existing);
  }

  // Walk day by day
  const points: ForecastDataPoint[] = [];
  let runningBalance = startingBalance;

  for (let i = 0; i <= lookaheadDays; i++) {
    const day = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = day.toISOString().split('T')[0];

    const dayObligations = obligationsByDate.get(dateStr) ?? [];
    const obligationsDueUsd = dayObligations.reduce((sum, o) => sum + o.amountUsd, 0);
    const obligationLabels = dayObligations.map((o) => o.label);

    // Deduct obligations, add avg daily ramp inflow
    runningBalance -= obligationsDueUsd;
    runningBalance += avgDailyRamp;

    // Safety buffer = sum of all obligations in remaining lookahead window from this day
    const remainingWindowEnd = new Date(day.getTime() + lookaheadDays * 24 * 60 * 60 * 1000);
    const futureObligations = expanded.filter((ob) => {
      const obDate = new Date(ob.date + 'T00:00:00Z');
      return obDate >= day && obDate <= remainingWindowEnd;
    });
    const safetyBufferUsd = futureObligations.reduce((sum, o) => sum + o.amountUsd, 0);

    points.push({
      date: dateStr,
      projectedBalanceUsd: Math.round(runningBalance * 100) / 100,
      obligationsDueUsd: Math.round(obligationsDueUsd * 100) / 100,
      safetyBufferUsd: Math.round(safetyBufferUsd * 100) / 100,
      isBelow: runningBalance < safetyBufferUsd,
      scheduledRampsUsd: Math.round(Math.max(0, avgDailyRamp) * 100) / 100,
      obligationLabels,
    });
  }

  return points;
}
