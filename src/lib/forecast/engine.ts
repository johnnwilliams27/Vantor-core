import type { Obligation } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';
import type { Projection, ProjectionDay, ScenarioParams, Shortfall } from './types';

interface ProjectArgs {
  state: TreasuryStateSnapshot;
  obligations: Obligation[];
  from: Date;
  windowDays: number;
  fxRates: Record<string, number>;
  scenarioParams: ScenarioParams;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Round a dollar amount to cents. Treasury balances are always denominated in
 * finite-precision currency units, so the running projection should never leak
 * IEEE754 float noise (e.g. 50_000 * 1.10 = 55000.00000000001). Every time we
 * write `totalBaseUsd` we pass it through this helper.
 */
function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export class ForecastEngine {
  project(args: ProjectArgs): Projection {
    const { state, obligations, from, windowDays, fxRates, scenarioParams } = args;

    const filtered = obligations.filter(o => {
      if (o.confidence === 'confirmed') return true;
      if (o.confidence === 'expected') return scenarioParams.includeExpected;
      if (o.confidence === 'estimated') return scenarioParams.includeEstimated;
      return false;
    });

    // Initial balance in base USD, optionally haircut by extraDrawdownPct
    const haircut = 1 - (scenarioParams.extraDrawdownPct / 100);
    const initialBase = state.totalValueBaseUsd * haircut;

    // Build date → delta map in base USD.
    // We also maintain a per-asset delta for balanceByAsset.
    const baseDeltaByDate = new Map<string, number>();
    const assetDeltaByDateAsset = new Map<string, Map<string, number>>(); // date -> asset -> delta native

    const fxRate = (currency: string): number => {
      const key = `${currency}->USD`;
      return fxRates[key] ?? 1;
    };

    for (const o of filtered) {
      const sign = o.direction === 'outflow' ? -1 : 1;
      const rate = fxRate(o.currency);
      const baseDelta = sign * o.amount * rate;
      baseDeltaByDate.set(o.dueDate, (baseDeltaByDate.get(o.dueDate) ?? 0) + baseDelta);

      const assetKey = o.asset ?? o.currency;
      if (!assetDeltaByDateAsset.has(o.dueDate)) assetDeltaByDateAsset.set(o.dueDate, new Map());
      const m = assetDeltaByDateAsset.get(o.dueDate)!;
      m.set(assetKey, (m.get(assetKey) ?? 0) + sign * o.amount);
    }

    // Build initial asset balances from state.positions
    const assetBalances: Record<string, number> = {};
    for (const b of state.positions.bankAccounts) {
      assetBalances[b.currency] = (assetBalances[b.currency] ?? 0) + b.balanceNative;
    }
    for (const w of state.positions.wallets) {
      assetBalances[w.token] = (assetBalances[w.token] ?? 0) + w.balanceNative;
    }
    // Apply day-0 haircut proportionally to each asset
    if (haircut !== 1) {
      for (const k of Object.keys(assetBalances)) assetBalances[k] *= haircut;
    }

    const daily: ProjectionDay[] = [];
    let runningBase = initialBase;

    for (let i = 0; i <= windowDays; i++) {
      const date = new Date(from.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      const delta = baseDeltaByDate.get(date) ?? 0;
      runningBase = roundCents(runningBase + delta);

      const assetMap = assetDeltaByDateAsset.get(date);
      if (assetMap) {
        assetMap.forEach((d, asset) => {
          assetBalances[asset] = (assetBalances[asset] ?? 0) + d;
        });
      }

      daily.push({
        date,
        balanceByAsset: { ...assetBalances },
        balanceByVenue: {}, // venue-level breakdown is future work; keep shape stable
        totalBaseUsd: runningBase,
      });
    }

    // min balance
    let minDay = daily[0];
    for (const d of daily) if (d.totalBaseUsd < minDay.totalBaseUsd) minDay = d;

    const byAsset: Record<string, { amount: number; date: string }> = {};
    for (const d of daily) {
      for (const [asset, amount] of Object.entries(d.balanceByAsset)) {
        if (!byAsset[asset] || amount < byAsset[asset].amount) {
          byAsset[asset] = { amount, date: d.date };
        }
      }
    }

    // Shortfalls: collapse each contiguous run of negative days into a single
    // Shortfall anchored at the first day of the run, with deficitAmount equal
    // to the deepest (most negative) balance observed within the run. This
    // matches treasurer mental-model — one "event" per liquidity gap, not one
    // per day underwater.
    const shortfalls: Shortfall[] = [];
    let runStartDate: string | null = null;
    let runDeepest = 0;
    for (const d of daily) {
      if (d.totalBaseUsd < 0) {
        if (runStartDate === null) {
          runStartDate = d.date;
          runDeepest = d.totalBaseUsd;
        } else if (d.totalBaseUsd < runDeepest) {
          runDeepest = d.totalBaseUsd;
        }
      } else if (runStartDate !== null) {
        shortfalls.push({
          date: runStartDate,
          asset: 'USD',
          venue: null,
          deficitAmount: roundCents(-runDeepest),
        });
        runStartDate = null;
        runDeepest = 0;
      }
    }
    if (runStartDate !== null) {
      shortfalls.push({
        date: runStartDate,
        asset: 'USD',
        venue: null,
        deficitAmount: roundCents(-runDeepest),
      });
    }

    return {
      daily,
      minBalance: { date: minDay.date, totalBaseUsd: minDay.totalBaseUsd, byAsset },
      shortfalls,
      covered: shortfalls.length === 0,
    };
  }
}
