import type { SupabaseClient } from '@supabase/supabase-js';
import type { ForecastDataPoint } from '@/types/database';
import { createForecastService } from '@/lib/forecast/service';

/**
 * @deprecated Transitional adapter — kept alive only so the legacy Treasury AI
 * forecast route (`/api/treasury/forecast/generate`) and the tab that reads
 * `treasury_forecasts.forecast_data` can keep working until Task 17 rewrites
 * the UI to consume the raw Projection shape from forecast_snapshots directly.
 *
 * The real forecast math now lives in `src/lib/forecast/engine.ts` (T10) and
 * is orchestrated by `createForecastService` (T12). This file just translates
 * the new Projection into the legacy 7-field ForecastDataPoint shape the UI
 * still reads today.
 *
 * Notes on the legacy shape:
 *   - `projectedBalanceUsd` — the engine's `day.totalBaseUsd` (rounded to
 *      cents, which the engine already does internally)
 *   - `obligationsDueUsd`   — sum of obligations whose dueDate matches the day
 *   - `safetyBufferUsd`     — legacy semantics: the total obligations still
 *      ahead of you from THIS day through the end of the window, so a
 *      `runningBalance < safetyBufferUsd` day is one where you don't have
 *      enough cash on hand to meet what's coming. The new Projection.shortfalls
 *      captures a cleaner version of the same idea, but the UI still reads
 *      safetyBufferUsd so we compute it here.
 *   - `isBelow`             — derived from the above
 *   - `scheduledRampsUsd`   — the legacy concept was "avg daily ramp inflow
 *      over the past 90 days". The new engine doesn't model scheduled ramps
 *      at all (they're an input to the state snapshot now, not a daily
 *      projection delta). We zero it out. The UI treats zero as "no scheduled
 *      ramps this day" which is acceptable during the transition.
 *   - `obligationLabels`    — labels of obligations due on that day, unchanged.
 */
export async function generateCashFlowForecast(
  supabase: SupabaseClient,
  _userId: string,
  lookaheadDays: number,
  enterpriseId: string,
): Promise<ForecastDataPoint[]> {
  if (!enterpriseId) return [];

  const svc = createForecastService({
    enterpriseId,
    db: supabase,
    consumer: 'treasurer_view',
  });
  const { projection, obligations } = await svc.getProjection(lookaheadDays);

  // Group obligations by due date for O(1) per-day lookup.
  interface ObligationBucket {
    totalUsd: number;
    labels: string[];
  }
  const byDate = new Map<string, ObligationBucket>();
  for (const o of obligations) {
    const bucket = byDate.get(o.dueDate) ?? { totalUsd: 0, labels: [] };
    // Obligations are already in USD for the legacy UI — non-USD is rare and
    // the legacy UI has no FX handling. For consistency with the engine's
    // internal math we use the same USD-coerced amount here.
    bucket.totalUsd += o.amount;
    bucket.labels.push(o.label);
    byDate.set(o.dueDate, bucket);
  }

  // Pre-compute "obligations still ahead from day i" so each day's safety
  // buffer is O(1) instead of O(n²).
  const forwardTotals: number[] = new Array(projection.daily.length).fill(0);
  for (let i = projection.daily.length - 1; i >= 0; i--) {
    const bucket = byDate.get(projection.daily[i].date);
    forwardTotals[i] = (forwardTotals[i + 1] ?? 0) + (bucket?.totalUsd ?? 0);
  }

  return projection.daily.map((day, i) => {
    const bucket = byDate.get(day.date);
    const obligationsDueUsd = bucket?.totalUsd ?? 0;
    const safetyBufferUsd = forwardTotals[i];
    return {
      date: day.date,
      projectedBalanceUsd: day.totalBaseUsd,
      obligationsDueUsd: Math.round(obligationsDueUsd * 100) / 100,
      safetyBufferUsd: Math.round(safetyBufferUsd * 100) / 100,
      isBelow: day.totalBaseUsd < safetyBufferUsd,
      scheduledRampsUsd: 0,
      obligationLabels: bucket?.labels ?? [],
    };
  });
}
