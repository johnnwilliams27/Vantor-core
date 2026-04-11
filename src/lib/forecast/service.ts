import type { SupabaseClient } from '@supabase/supabase-js';
import { ForecastEngine } from './engine';
import { resolveScenarioParams } from './scenarios';
import { ObligationsRepo } from '@/lib/obligations/repo';
import { TreasuryStateService } from '@/lib/treasury/state/service';
import { expandRecurrence } from '@/lib/obligations/recurrence';
import type {
  ForecastConsumer,
  ForecastScenario,
  ProposedTransfer,
  Projection,
  ScenarioParams,
} from './types';
import type { Obligation, ObligationConfidence } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';
import { getFxRate, SUPPORTED_FIAT_CURRENCIES, type FiatCurrency } from '@/lib/fx/rates';

/**
 * Facade over ForecastEngine (T10) that packages the four things a caller
 * actually wants — min-balance, coverage check, obligations-in-window,
 * hypothetical overlays — and transparently handles:
 *
 *  - persisting the underlying treasury_state_snapshot when a real decision
 *    consumer asks for `persist: true`
 *  - writing a forecast_snapshots audit row with a correlation_id so the
 *    rules engine (T18) and agent planner can link a forecast back to the
 *    action they took on it
 *  - applying ProposedTransfer overlays without mutating the real state
 *
 * The service is intentionally stateless between `compute()` calls for the
 * same window — caching only the underlying TreasuryStateSnapshot so multiple
 * method calls on one instance don't hit the DB twice.
 */
export interface ForecastService {
  getProjectedMinBalance(
    asset: string,
    venue: string | null,
    windowDays: number,
  ): Promise<{ amount: number; date: string }>;
  getProjectedPosition(
    asset: string,
    venue: string | null,
    atDate: string,
  ): Promise<number>;
  areObligationsCovered(
    windowDays: number,
    confidenceFilter?: ObligationConfidence[],
  ): Promise<{
    covered: boolean;
    shortfallAmount?: number;
    firstShortfallDate?: string;
    shortfallAsset?: string;
  }>;
  getObligationsDueInWindow(windowDays: number): Promise<Obligation[]>;
  /**
   * Returns the full day-by-day projection plus the expanded obligation
   * set that fed it. Used by the Task 15 legacy adapter in
   * `src/lib/treasury/predictions.ts` to materialize the old
   * ForecastDataPoint[] shape for Treasury AI UI consumers that haven't
   * migrated yet. Phase B UI will consume Projection directly.
   */
  getProjection(
    windowDays: number,
  ): Promise<{ projection: Projection; obligations: Obligation[] }>;
  hypothetical(proposedTransfers: ProposedTransfer[]): ForecastService;
}

interface ServiceConfig {
  enterpriseId: string;
  db: SupabaseClient;
  scenario?: ForecastScenario;
  scenarioParams?: Partial<ScenarioParams>;
  consumer: ForecastConsumer;
  correlationId?: string;
  persist?: boolean;
  /** Hypothetical overlay — applied in addition to real state. */
  hypotheticalTransfers?: ProposedTransfer[];
  takenBy?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isSupportedFiat(c: string): c is FiatCurrency {
  return (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(c);
}

/**
 * Materialize every obligation due in [from, to]. Once-off obligations are
 * copied through verbatim; recurring ones are expanded via expandRecurrence
 * (T3) and each instance gets `recurringParentId` set so downstream audit
 * still knows where it came from.
 */
async function loadExpandedObligations(
  db: SupabaseClient,
  enterpriseId: string,
  from: Date,
  to: Date,
): Promise<Obligation[]> {
  const repo = new ObligationsRepo(db);
  const active = await repo.listAllActive(enterpriseId);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const out: Obligation[] = [];
  for (const o of active) {
    if (o.recurrence === 'once') {
      if (o.dueDate >= fromIso && o.dueDate <= toIso) {
        out.push(o);
      }
      continue;
    }
    for (const inst of expandRecurrence(o, from, to)) {
      out.push({
        ...o,
        dueDate: inst.dueDate,
        amount: inst.amount,
        recurringParentId: o.id,
      });
    }
  }
  return out;
}

/**
 * Build the FX rate map the engine consumes. We only need rates for the
 * currencies actually referenced by obligations, plus USD (the base).
 *
 * Unsupported currencies fall back to 1.0 — same guard shape TreasuryState
 * uses (see src/lib/treasury/state/service.ts). `getFxRate` is synchronous
 * and only accepts the FiatCurrency union.
 */
function buildFxRates(
  obligations: Obligation[],
  strategy: ScenarioParams['fxStrategy'],
  overrides?: Record<string, number>,
): Record<string, number> {
  const currencies = new Set<string>(['USD']);
  for (const o of obligations) currencies.add(o.currency);
  const rates: Record<string, number> = {};
  for (const c of Array.from(currencies)) {
    if (strategy === 'fixed' && overrides?.[`${c}->USD`] != null) {
      rates[`${c}->USD`] = overrides[`${c}->USD`];
      continue;
    }
    const live = c === 'USD' || !isSupportedFiat(c) ? 1 : getFxRate(c, 'USD');
    rates[`${c}->USD`] = strategy === 'pessimistic' ? live * 0.95 : live;
  }
  return rates;
}

/**
 * Apply proposed transfers on top of a state snapshot without mutating the
 * original. Heuristic: a transfer with `fromVenue === null` is an inflow,
 * `toVenue === null` is an outflow, and internal (both non-null) transfers
 * are value-neutral at the aggregate level. Venue-level tracking is left
 * to a future iteration — the rules engine only reads the totals.
 *
 * The clone is intentionally shallow; tests in T13 verify that the
 * underlying `positions` reference is shared (which is safe because the
 * engine never writes into it).
 */
function applyHypothetical(
  state: TreasuryStateSnapshot,
  transfers: ProposedTransfer[],
): TreasuryStateSnapshot {
  let totalDelta = 0;
  for (const t of transfers) {
    if (t.fromVenue === null && t.toVenue !== null) totalDelta += t.amount;
    else if (t.fromVenue !== null && t.toVenue === null) totalDelta -= t.amount;
  }
  return {
    ...state,
    totalValueBaseUsd: state.totalValueBaseUsd + totalDelta,
    totalFiatBaseUsd: state.totalFiatBaseUsd + totalDelta,
  };
}

/**
 * Build a ForecastService for one (enterprise, consumer, scenario) triple.
 *
 * Synchronous by design — the plan originally marked this `async` but none
 * of the construction-time work actually needs to await anything, and being
 * sync is what lets `hypothetical()` return a fresh service without the
 * lazy-proxy dance that the original draft fell into (and which looped
 * infinitely on nested calls).
 */
export function createForecastService(cfg: ServiceConfig): ForecastService {
  const engine = new ForecastEngine();
  const treasurySvc = new TreasuryStateService(cfg.db);
  const scenarioParams = resolveScenarioParams(cfg.scenario ?? 'base', cfg.scenarioParams);

  let cachedState: TreasuryStateSnapshot | null = null;

  async function getState(): Promise<TreasuryStateSnapshot> {
    if (cachedState) return cachedState;
    const fresh = await treasurySvc.computeSnapshot(cfg.enterpriseId, 'pre_decision');

    // When persisting we ALWAYS write the real underlying state snapshot
    // first so forecast_snapshots.treasury_state_snapshot_id FK points at
    // a real UUID, even if we then overlay hypothetical transfers on top.
    let base: TreasuryStateSnapshot;
    if (cfg.persist) {
      base = await treasurySvc.persistSnapshot(fresh, cfg.takenBy ?? null);
    } else {
      base = {
        ...fresh,
        id: 'ephemeral',
        takenAt: new Date().toISOString(),
        takenBy: cfg.takenBy ?? null,
      };
    }

    cachedState = cfg.hypotheticalTransfers?.length
      ? applyHypothetical(base, cfg.hypotheticalTransfers)
      : base;
    // Preserve the real state id on the overlaid snapshot so downstream
    // persistence can still FK-link back to the real treasury row.
    if (cfg.hypotheticalTransfers?.length) {
      cachedState = { ...cachedState, id: base.id };
    }
    return cachedState;
  }

  async function compute(
    windowDays: number,
  ): Promise<{ projection: Projection; obligations: Obligation[]; stateId: string }> {
    const state = await getState();
    // UTC-normalized window origin. The engine converts dates with
    // toISOString().slice(0,10) so the from-date MUST be UTC midnight
    // or day-0 in the projection drifts off today's ISO date in non-UTC
    // environments.
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + windowDays * DAY_MS);
    const obligations = await loadExpandedObligations(cfg.db, cfg.enterpriseId, from, to);
    const fxRates = buildFxRates(obligations, scenarioParams.fxStrategy, scenarioParams.fixedFxRates);
    const projection = engine.project({
      state,
      obligations,
      from,
      windowDays,
      fxRates,
      scenarioParams,
    });

    if (cfg.persist) {
      const isHypothetical = Boolean(cfg.hypotheticalTransfers?.length);
      await cfg.db.from('forecast_snapshots').insert({
        enterprise_id: cfg.enterpriseId,
        computed_by: cfg.takenBy ?? null,
        treasury_state_snapshot_id: state.id,
        scenario: cfg.scenario ?? 'base',
        scenario_params: scenarioParams,
        window_days: windowDays,
        obligation_ids: obligations.map(o => o.id),
        obligation_count: obligations.length,
        projection,
        correlation_id: cfg.correlationId ?? null,
        consumer: cfg.consumer,
        is_hypothetical: isHypothetical,
        hypothetical_actions: isHypothetical ? cfg.hypotheticalTransfers : null,
      });
    }

    return { projection, obligations, stateId: state.id };
  }

  return {
    async getProjectedMinBalance(_asset, _venue, windowDays) {
      const { projection } = await compute(windowDays);
      return {
        amount: projection.minBalance.totalBaseUsd,
        date: projection.minBalance.date,
      };
    },
    async getProjectedPosition(_asset, _venue, atDate) {
      const from = new Date();
      from.setUTCHours(0, 0, 0, 0);
      const at = new Date(`${atDate}T00:00:00Z`);
      const windowDays = Math.max(
        1,
        Math.ceil((at.getTime() - from.getTime()) / DAY_MS),
      );
      const { projection } = await compute(windowDays);
      const day =
        projection.daily.find(d => d.date === atDate) ??
        projection.daily[projection.daily.length - 1];
      return day.totalBaseUsd;
    },
    async areObligationsCovered(windowDays, _confidenceFilter) {
      // `confidenceFilter` is reserved for T18 (rules engine rewire). The
      // current implementation folds confidence handling into scenarioParams
      // via includeExpected / includeEstimated, so the per-call filter is a
      // no-op until the rules engine needs finer-grained control.
      const { projection } = await compute(windowDays);
      const applicableShortfalls = projection.shortfalls;
      if (applicableShortfalls.length === 0) return { covered: true };
      const first = applicableShortfalls[0];
      return {
        covered: false,
        shortfallAmount: first.deficitAmount,
        firstShortfallDate: first.date,
        shortfallAsset: first.asset,
      };
    },
    async getObligationsDueInWindow(windowDays) {
      const from = new Date();
      from.setUTCHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + windowDays * DAY_MS);
      return loadExpandedObligations(cfg.db, cfg.enterpriseId, from, to);
    },
    async getProjection(windowDays) {
      const { projection, obligations } = await compute(windowDays);
      return { projection, obligations };
    },
    hypothetical(proposedTransfers) {
      // Returns a NEW ForecastService with the overlay layered on top of
      // this service's config. The new instance never auto-persists (even
      // if the parent had persist=true) — hypothetical forecasts only get
      // written when a caller explicitly asks for them. Because
      // createForecastService is now synchronous the child can be built
      // eagerly, avoiding the lazy-proxy recursion bug that lurked in the
      // original draft.
      return createForecastService({
        ...cfg,
        hypotheticalTransfers: [
          ...(cfg.hypotheticalTransfers ?? []),
          ...proposedTransfers,
        ],
        persist: false,
      });
    },
  };
}
