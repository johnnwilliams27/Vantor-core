import type { Obligation, ObligationRecurrence } from './types';

export interface ExpandedInstance {
  dueDate: string;
  amount: number;
  currency: string;
  label: string;
  recurringParentId: string;
  direction: Obligation['direction'];
  confidence: Obligation['confidence'];
  asset: Obligation['asset'];
}

const INTERVAL_DAYS: Partial<Record<ObligationRecurrence, number>> = {
  weekly: 7,
  biweekly: 14,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function addCalendarMonths(base: Date, months: number): Date {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const targetMonthRaw = month + months;
  const targetYear = year + Math.floor(targetMonthRaw / 12);
  const targetMonth = ((targetMonthRaw % 12) + 12) % 12;
  // Day 0 of next month = last day of current month. Use it to clamp.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay));
}

/**
 * Expand a recurring obligation into concrete dated instances within [from, to] (inclusive).
 *
 * Recurrence semantics:
 * - weekly, biweekly: fixed 7/14 day intervals from the base dueDate.
 * - monthly, quarterly, annual: calendar arithmetic. Preserves the original day of month
 *   across cycles, clamping to the last day of the target month when the day doesn't
 *   exist (e.g. monthly from Jan 31 → Feb 28 → Mar 31 → Apr 30, not Jan 31 → Mar 3).
 *   The Nth occurrence is always computed from the base date, never from the previous
 *   occurrence, to prevent end-of-month drift.
 * - once: single instance at dueDate if within [from, to].
 * - custom: requires cron support, not yet implemented in Phase A (throws).
 *
 * Pure function: no Date.now(), no I/O, no module-level mutable state.
 */
export function expandRecurrence(
  ob: Obligation,
  from: Date,
  to: Date,
): ExpandedInstance[] {
  const instance = (dueDate: string): ExpandedInstance => ({
    dueDate,
    amount: ob.amount,
    currency: ob.currency,
    label: ob.label,
    recurringParentId: ob.id,
    direction: ob.direction,
    confidence: ob.confidence,
    asset: ob.asset,
  });

  if (ob.recurrence === 'once') {
    const due = parseDate(ob.dueDate).getTime();
    if (due >= from.getTime() && due <= to.getTime()) {
      return [instance(ob.dueDate)];
    }
    return [];
  }

  if (ob.recurrence === 'custom') {
    if (!ob.recurrenceCron) {
      throw new Error('recurrenceCron is required for custom recurrence');
    }
    // Minimal: custom cron parsing is out of scope for Phase A; treat as unsupported
    // and require the caller to provide a materialized schedule via another path.
    throw new Error('Custom cron recurrence not yet supported in expandRecurrence');
  }

  // Calendar-based branches: monthly, quarterly, annual
  const calendarMonthsPerStep: Partial<Record<ObligationRecurrence, number>> = {
    monthly: 1,
    quarterly: 3,
    annual: 12,
  };

  const monthsPerStep = calendarMonthsPerStep[ob.recurrence];
  if (monthsPerStep !== undefined) {
    const base = parseDate(ob.dueDate);
    let n = 0;
    let current = addCalendarMonths(base, 0);
    // Fast-forward to the first occurrence at or after `from`
    while (current.getTime() < from.getTime()) {
      n++;
      current = addCalendarMonths(base, n * monthsPerStep);
    }
    const out: ExpandedInstance[] = [];
    while (current.getTime() <= to.getTime()) {
      out.push(instance(toDateOnly(current)));
      n++;
      current = addCalendarMonths(base, n * monthsPerStep);
    }
    return out;
  }

  // Fixed-day-interval branches: weekly, biweekly
  const intervalDays = INTERVAL_DAYS[ob.recurrence];
  if (!intervalDays) {
    throw new Error(`Unknown recurrence: ${ob.recurrence}`);
  }
  const intervalMs = intervalDays * DAY_MS;

  const base = parseDate(ob.dueDate);
  let current = base;
  // Fast-forward to the first occurrence at or after `from`
  while (current.getTime() < from.getTime()) {
    current = new Date(current.getTime() + intervalMs);
  }

  const out: ExpandedInstance[] = [];
  while (current.getTime() <= to.getTime()) {
    out.push(instance(toDateOnly(current)));
    current = new Date(current.getTime() + intervalMs);
  }
  return out;
}
