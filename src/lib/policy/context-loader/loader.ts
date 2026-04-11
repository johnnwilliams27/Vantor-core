// src/lib/policy/context-loader/loader.ts

import {
  EvaluationContext,
  ForecastSnapshot,
  ForecastQueryResult,
} from '../types/context';
import { ProposedMovement } from '../types/movement';
import { PolicyVersionSnapshot } from '../types/policy-version';
import { Condition } from '../types/ir';
import { AssetCode, VenueId } from '../types/assets';
import { canonicalizeToUsd } from '../canonicalizer/canonicalizer';
import { PolicyRateProvider } from '../canonicalizer/interface';
import { AggregationDetector } from '../aggregate-detector/detector';
import { ForecastQueryFactory, ForecastQuery } from '../forecast/interface';
import { loadTreasuryState, BalanceRow } from './treasury-state';
import { loadCounterparty, CounterpartyHistoryRow } from './counterparty';
import { loadSanctions, SanctionsScreeningRow } from './sanctions';
import { computeForecastQueryHash } from '../ir-evaluator/leaves/forecast-query';

export interface EvaluationContextLoaderDeps {
  rateProvider: PolicyRateProvider;
  aggregateDetector: AggregationDetector;
  forecastFactory: ForecastQueryFactory;
  fetchPolicyVersion: (enterpriseId: string) => Promise<PolicyVersionSnapshot>;
  fetchBalances: (enterpriseId: string) => Promise<BalanceRow[]>;
  fetchCounterpartyHistory: (
    enterpriseId: string,
    counterpartyId: string,
  ) => Promise<CounterpartyHistoryRow | null>;
  fetchLatestScreening: (
    enterpriseId: string,
    counterpartyId: string,
  ) => Promise<SanctionsScreeningRow | null>;
}

/**
 * EvaluationContextLoader assembles a fully-hydrated EvaluationContext
 * from DI'd data sources. Loads the 6 parallel-safe components via
 * Promise.all, then loads aggregates (which depend on the policy version)
 * and pre-loads forecast query results (which require the forecast query
 * instance).
 *
 * ERROR SEMANTICS:
 * - Sub-loaders (treasury, counterparty, sanctions, canonicalization)
 *   never throw — errors become structured failure fields.
 * - `fetchPolicyVersion` is the ONLY required data source. If it throws,
 *   the loader re-throws — without a policy version, there's nothing to
 *   evaluate, and the engine's top-level catch must surface this as a
 *   gate-internal-error. Callers must be prepared for this single
 *   exception path. Note: when fetchPolicyVersion rejects, `Promise.all`
 *   waits for the other five sub-loaders to settle (it doesn't cancel
 *   them) and then surfaces the rejection — no resource leak, just a
 *   brief wait while in-flight peers complete.
 * - `forecastFactory.createForEnterprise` is wrapped — if the factory
 *   throws, the loader falls back to a sentinel failure forecast where
 *   every forecast query request produces forecast_unavailable.
 * - Individual forecast query pre-loads are per-query try/catch; a
 *   failing query becomes a failure entry on its hash key.
 */
export class EvaluationContextLoader {
  constructor(private readonly deps: EvaluationContextLoaderDeps) {}

  async load(movement: ProposedMovement, enterpriseId: string): Promise<EvaluationContext> {
    // Capture `now` once at the start so all sub-loads and the final ctx
    // use a consistent timestamp
    const now = new Date();

    // Load the 6 parallel-safe components. fetchPolicyVersion throws on
    // error (documented above) — Promise.all will reject and the caller
    // must handle it.
    const [
      policyVersion,
      treasuryState,
      counterparty,
      sanctions,
      canonicalization,
      forecastQuery,
    ] = await Promise.all([
      this.deps.fetchPolicyVersion(enterpriseId),
      loadTreasuryState(enterpriseId, { fetchBalances: this.deps.fetchBalances }),
      loadCounterparty(enterpriseId, movement.counterparty?.id, {
        fetchCounterpartyHistory: this.deps.fetchCounterpartyHistory,
      }),
      loadSanctions(enterpriseId, movement.counterparty?.id, {
        fetchLatestScreening: this.deps.fetchLatestScreening,
      }),
      canonicalizeToUsd(movement.amount, this.deps.rateProvider, now),
      this.createForecastQuerySafely(enterpriseId, now),
    ]);

    // Aggregates depend on the policy version, so load after
    const aggregates = await this.deps.aggregateDetector.loadAggregates(
      movement,
      enterpriseId,
      policyVersion,
    );

    // Pre-load forecast query results referenced by the policy
    const forecast = await this.preloadForecastResults(forecastQuery, movement, policyVersion, now);

    return {
      now,
      enterprise_id: enterpriseId,
      policy_version: policyVersion,
      treasury_state: treasuryState,
      canonicalization,
      aggregates,
      sanctions,
      forecast,
      counterparty,
    };
  }

  /**
   * Wrap the forecast factory in a try/catch. On failure, return a
   * ForecastQuery sentinel whose every method rejects with a tagged
   * error. The per-query try/catch in preloadForecastResults converts
   * these into structured forecast_unavailable failures.
   *
   * Passes the shared `now` so the sentinel's metadata.snapshot_taken_at
   * matches the rest of the context instead of drifting by a few ms.
   */
  private async createForecastQuerySafely(
    enterpriseId: string,
    now: Date,
  ): Promise<ForecastQuery> {
    try {
      return await this.deps.forecastFactory.createForEnterprise(enterpriseId);
    } catch (err) {
      return new FailedForecastQuery(err, now);
    }
  }

  private async preloadForecastResults(
    query: ForecastQuery,
    movement: ProposedMovement,
    policy: PolicyVersionSnapshot,
    now: Date,
  ): Promise<ForecastSnapshot> {
    const queryRequests = this.extractForecastQueryRequests(policy);

    // hypothetical() returns a new query instance scoped to post-state.
    // Wrap in try/catch in case the factory's sentinel rejects.
    let hypothetical: ForecastQuery;
    try {
      hypothetical = query.hypothetical(movement);
    } catch (err) {
      hypothetical = new FailedForecastQuery(err, now);
    }

    // Execute all forecast queries in parallel. Each request becomes one
    // entry in `results` keyed by its hash.
    const resultEntries = await Promise.all(
      queryRequests.map(async (req) => {
        const targetQuery = req.use_hypothetical ? hypothetical : query;
        try {
          let value: unknown;
          switch (req.kind) {
            case 'obligations_covered':
              value = await targetQuery.areObligationsCovered(req.window_days);
              break;
            case 'projected_min_balance':
              value = await targetQuery.getProjectedMinBalance(
                (req.asset ?? 'USD') as AssetCode,
                req.venue ?? null,
                req.window_days,
              );
              break;
            case 'projected_position':
              value = await targetQuery.getProjectedPosition(
                (req.asset ?? 'USD') as AssetCode,
                req.venue ?? null,
                new Date(Date.now() + req.window_days * 86_400_000),
              );
              break;
            default:
              return assertNeverQueryKind(req.kind, req.hash);
          }
          return [req.hash, { value }] as const;
        } catch (err) {
          return [
            req.hash,
            {
              failure: {
                reason_code: 'forecast_unavailable' as const,
                human_readable: `Forecast query ${req.kind} failed: ${err instanceof Error ? err.message : String(err)}`,
                details: { kind: req.kind, window_days: req.window_days },
              },
            },
          ] as const;
        }
      }),
    );

    const results: Record<string, ForecastQueryResult> = Object.fromEntries(resultEntries);

    return {
      query_metadata: query.metadata,
      hypothetical_metadata: hypothetical.metadata,
      results,
    };
  }

  /**
   * Walk the policy version's rules, approval chain trigger conditions,
   * and hard limits to find every forecast query reference. Deduplicates
   * by hash.
   *
   * Rule-level forecast queries use `use_hypothetical=false` (pre-state).
   * Hard-limit-level obligation_coverage_days uses `use_hypothetical=true`
   * (post-state) because hard limits check what the treasury state would
   * be after the proposed movement is applied.
   */
  private extractForecastQueryRequests(policy: PolicyVersionSnapshot): ForecastQueryRequest[] {
    const requests: ForecastQueryRequest[] = [];
    const seen = new Set<string>();

    for (const rule of policy.rules) {
      this.walkForecastNodes(rule.condition, requests, seen, false);
    }

    for (const chain of policy.approval_chains) {
      if (chain.trigger_condition) {
        this.walkForecastNodes(chain.trigger_condition, requests, seen, false);
      }
    }

    for (const limit of policy.hard_limits) {
      if (limit.limit_type === 'obligation_coverage_days') {
        // Guard against malformed limit_value (same check as the
        // obligation-coverage hard-limit evaluator)
        const windowDays = Number(limit.limit_value);
        if (!Number.isFinite(windowDays) || !Number.isInteger(windowDays) || windowDays <= 0) {
          // The limit checker will surface this failure itself; we just
          // skip the pre-load so we don't pollute results with a bogus hash
          continue;
        }
        const hash = computeForecastQueryHash({
          kind: 'forecast_query',
          query: 'obligations_covered',
          window_days: windowDays,
          comparator: '==',
          value: { amount: '1', currency: 'USD' },
        });
        if (!seen.has(hash)) {
          seen.add(hash);
          requests.push({
            hash,
            kind: 'obligations_covered',
            window_days: windowDays,
            use_hypothetical: true,
          });
        }
      }
    }

    return requests;
  }

  private walkForecastNodes(
    cond: Condition,
    requests: ForecastQueryRequest[],
    seen: Set<string>,
    useHypothetical: boolean,
  ): void {
    switch (cond.kind) {
      case 'and':
      case 'or':
        cond.children.forEach((c) => this.walkForecastNodes(c, requests, seen, useHypothetical));
        return;
      case 'not':
        this.walkForecastNodes(cond.child, requests, seen, useHypothetical);
        return;
      case 'forecast_query': {
        const hash = computeForecastQueryHash(cond);
        if (!seen.has(hash)) {
          seen.add(hash);
          requests.push({
            hash,
            kind: cond.query,
            window_days: cond.window_days,
            asset: cond.scope?.asset,
            venue: cond.scope?.venue,
            use_hypothetical: useHypothetical,
          });
        }
        return;
      }
      case 'amount_compare':
      case 'string_compare':
      case 'time_compare':
      case 'sanctions_status':
      case 'aggregate_window':
        // Non-forecast leaves — nothing to collect
        return;
      default:
        return assertNeverKind(cond);
    }
  }
}

interface ForecastQueryRequest {
  hash: string;
  kind: 'projected_min_balance' | 'projected_position' | 'obligations_covered';
  window_days: number;
  asset?: AssetCode;
  venue?: VenueId;
  use_hypothetical: boolean;
}

/**
 * Sentinel ForecastQuery used when the forecast factory fails. Every
 * method rejects with the original error so the per-query try/catch in
 * preloadForecastResults wraps it into a structured failure entry.
 */
class FailedForecastQuery implements ForecastQuery {
  readonly metadata: {
    mode: 'stub';
    snapshot_taken_at: Date;
    source: string;
    warnings: string[];
  };
  constructor(
    private readonly error: unknown,
    snapshotTakenAt: Date,
  ) {
    this.metadata = {
      // PHASE-1 LIMITATION: ForecastQueryMetadata.mode is 'stub' | 'real'
      // so we must label a factory-failure sentinel as 'stub'. Plan 2
      // should extend the union to 'failed' so observers (audit, UI) can
      // distinguish a real stub from a factory failure.
      mode: 'stub',
      snapshot_taken_at: snapshotTakenAt,
      source: 'failed-forecast-factory',
      warnings: ['Forecast factory threw during context load; all forecast queries will fail.'],
    };
  }
  private reject(): Promise<never> {
    return Promise.reject(
      this.error instanceof Error
        ? this.error
        : new Error(`Forecast factory failed: ${String(this.error)}`),
    );
  }
  getProjectedMinBalance(): Promise<never> {
    return this.reject();
  }
  getProjectedPosition(): Promise<never> {
    return this.reject();
  }
  areObligationsCovered(): Promise<never> {
    return this.reject();
  }
  getObligationsDueInWindow(): Promise<never> {
    return this.reject();
  }
  hypothetical(): ForecastQuery {
    return this;
  }
}

function assertNeverKind(x: never): never {
  throw new Error(`Unhandled Condition kind in walkForecastNodes: ${JSON.stringify(x)}`);
}

function assertNeverQueryKind(kind: never, hash: string): readonly [string, ForecastQueryResult] {
  return [
    hash,
    {
      failure: {
        reason_code: 'forecast_unavailable',
        human_readable: `Unhandled forecast query kind: ${String(kind)}`,
        details: { kind: String(kind) },
      },
    },
  ] as const;
}
