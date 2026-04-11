// src/lib/policy/aggregate-detector/detector.ts

import { PolicyVersionSnapshot } from '../types/policy-version';
import { ProposedMovement } from '../types/movement';
import { Condition, WindowSpec } from '../types/ir';
import { AggregateWindowResults, AggregateWindowResult } from '../types/context';
import { RunAggregateQuery } from './queries';
import { computeWindowSpecHash } from './hash';

export interface AggregationDetectorDeps {
  runQuery: RunAggregateQuery;
}

/**
 * The always-on 24h splitting guard spec. Grouped by (initiator, destination)
 * to detect the canonical "structured to evade a rule" pattern. The splitting
 * guard aggregate is populated on EVERY evaluation — it's part of the system
 * contract, not a user-authored window.
 */
const SPLITTING_GUARD_SPEC: WindowSpec = {
  duration_ms: 86_400_000,
  group_by: { initiator: true, destination: true },
  direction: 'outflow',
};

/**
 * Async detector that pre-loads all aggregate window queries referenced by
 * the active policy version plus the always-on system splitting guard.
 *
 * Walks policy.rules[].condition and policy.approval_chains[].trigger_condition
 * looking for aggregate_window nodes, deduplicates by window_spec hash, and
 * executes one query per unique spec. Query execution is dependency-injected
 * (RunAggregateQuery) so this module doesn't import a Supabase client.
 *
 * PHASE-1 FAILURE SEMANTICS: per-spec failures are captured on the
 * AggregateWindowResult.failure field, not raised. The caller (context
 * loader → engine) decides how to surface them. The splitting guard gets
 * the same treatment — a failed splitting query produces a result row with
 * failure set, and downstream code (amount_compare leaf, hard-limit max
 * outflow checker) treats that as cannot-fully-evaluate.
 */
export class AggregationDetector {
  constructor(private readonly deps: AggregationDetectorDeps) {}

  async loadAggregates(
    movement: ProposedMovement,
    enterpriseId: string,
    policy: PolicyVersionSnapshot,
  ): Promise<AggregateWindowResults> {
    const userSpecs = this.extractWindowSpecs(policy);
    const now = new Date();

    // Run splitting guard and all user specs in parallel. Each runOne
    // returns a result (possibly with failure) — it never throws.
    const splittingGuardPromise = this.runOne(SPLITTING_GUARD_SPEC, movement, enterpriseId, now);

    const userEntries = Array.from(userSpecs.entries());
    const userPromises = userEntries.map(([, spec]) =>
      this.runOne(spec, movement, enterpriseId, now),
    );

    const [splittingGuardResult, ...userResultList] = await Promise.all([
      splittingGuardPromise,
      ...userPromises,
    ]);

    const userResults: Record<string, AggregateWindowResult> = {};
    for (let i = 0; i < userEntries.length; i++) {
      userResults[userEntries[i][0]] = userResultList[i];
    }

    return {
      system_splitting_guard_24h: splittingGuardResult,
      user_specs: userResults,
    };
  }

  /**
   * Walk the policy version for aggregate_window nodes. Deduplicates by
   * window spec hash so multiple rules referencing the same window spec
   * produce only one query.
   */
  private extractWindowSpecs(policy: PolicyVersionSnapshot): Map<string, WindowSpec> {
    const map = new Map<string, WindowSpec>();

    for (const rule of policy.rules) {
      this.walkCondition(rule.condition, map);
    }
    for (const chain of policy.approval_chains) {
      if (chain.trigger_condition) {
        this.walkCondition(chain.trigger_condition, map);
      }
    }

    return map;
  }

  /**
   * Recursive walker over a Condition tree, collecting aggregate_window
   * specs into `map` by hash. Non-aggregate leaves are intentionally
   * skipped — the detector only cares about aggregate nodes. If a new
   * Condition kind is added, it defaults to skip (safe for this walker
   * since only aggregate_window carries a WindowSpec).
   */
  private walkCondition(cond: Condition, map: Map<string, WindowSpec>): void {
    switch (cond.kind) {
      case 'and':
      case 'or':
        cond.children.forEach((c) => this.walkCondition(c, map));
        return;
      case 'not':
        this.walkCondition(cond.child, map);
        return;
      case 'aggregate_window': {
        const hash = computeWindowSpecHash(cond.window);
        if (!map.has(hash)) {
          map.set(hash, cond.window);
        }
        return;
      }
      case 'amount_compare':
      case 'string_compare':
      case 'time_compare':
      case 'sanctions_status':
      case 'forecast_query':
        // Leaves without aggregate_window children — nothing to collect
        return;
      default:
        return assertNeverKind(cond);
    }
  }

  /**
   * Execute a single aggregate window query. Catches query errors and
   * wraps them in an AggregateWindowResult with a failure field so the
   * caller sees a structured result rather than an unhandled rejection.
   */
  private async runOne(
    spec: WindowSpec,
    movement: ProposedMovement,
    enterpriseId: string,
    now: Date,
  ): Promise<AggregateWindowResult> {
    const hash = computeWindowSpecHash(spec);
    const windowStart = new Date(now.getTime() - spec.duration_ms);
    const windowEnd = now;

    try {
      const raw = await this.deps.runQuery({
        enterpriseId,
        window: spec,
        movement,
        windowStart,
        windowEnd,
      });

      return {
        window_spec_hash: hash,
        window_start: windowStart,
        window_end: windowEnd,
        sum_amount_usd: raw.sum_amount_usd,
        sum_amount_by_asset: raw.sum_amount_by_asset,
        count: raw.count,
        distinct_destinations: raw.distinct_destinations,
        distinct_counterparties: raw.distinct_counterparties,
        included_evaluation_ids: raw.included_evaluation_ids,
        includes_proposed: false,
      };
    } catch (err) {
      return {
        window_spec_hash: hash,
        window_start: windowStart,
        window_end: windowEnd,
        sum_amount_usd: '',
        sum_amount_by_asset: {},
        count: 0,
        distinct_destinations: 0,
        distinct_counterparties: 0,
        included_evaluation_ids: [],
        includes_proposed: false,
        failure: {
          reason_code: 'aggregate_query_failed',
          human_readable: `Aggregate window query failed: ${err instanceof Error ? err.message : String(err)}`,
          details: { window_spec: spec, error_class: err instanceof Error ? err.name : typeof err },
        },
      };
    }
  }
}

function assertNeverKind(x: never): never {
  throw new Error(`Unhandled Condition kind in AggregationDetector.walkCondition: ${JSON.stringify(x)}`);
}
