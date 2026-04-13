// src/lib/policy/forecast/real.ts
//
// Production ForecastQueryFactory / ForecastQuery adapter. Wraps the
// real `ForecastService` from src/lib/forecast/service.ts and translates
// its shapes into the policy engine's ForecastQuery contract.
//
// Replaces `StubForecastQueryFactory` in production-wiring.ts. The stub
// had returned permissive defaults (999_999_999_999_999_999 balances,
// covered=true), so every forecast-dependent policy rule silently
// passed. Real numbers now flow through the gate.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createForecastService, type ForecastService } from '@/lib/forecast/service';
import type { Obligation as RealObligation } from '@/lib/obligations/types';
import type { ProposedTransfer } from '@/lib/forecast/types';
import type { AssetCode, AmountNative, VenueId } from '../types/assets';
import type { ProposedMovement } from '../types/movement';
import type {
  ForecastQuery,
  ForecastQueryFactory,
  ForecastQueryMetadata,
  Obligation as PolicyObligation,
  ObligationCoverageResult,
} from './interface';

/** Adapts a real `ForecastService` to the policy engine's `ForecastQuery`. */
export class RealForecastQuery implements ForecastQuery {
  readonly metadata: ForecastQueryMetadata;

  constructor(
    private readonly service: ForecastService,
    snapshotTime: Date = new Date(),
  ) {
    this.metadata = {
      mode: 'real',
      snapshot_taken_at: snapshotTime,
      source: 'forecast-service',
      warnings: [],
    };
  }

  async getProjectedMinBalance(
    asset: AssetCode,
    venue: VenueId | null,
    windowDays: number,
  ): Promise<AmountNative> {
    const { amount } = await this.service.getProjectedMinBalance(
      asset,
      venue,
      windowDays,
    );
    return { amount: amount.toString(), asset };
  }

  async getProjectedPosition(
    asset: AssetCode,
    venue: VenueId | null,
    atDate: Date,
  ): Promise<AmountNative> {
    const atIso = atDate.toISOString().slice(0, 10);
    const amount = await this.service.getProjectedPosition(asset, venue, atIso);
    return { amount: amount.toString(), asset };
  }

  async areObligationsCovered(windowDays: number): Promise<ObligationCoverageResult> {
    // The real service's areObligationsCovered doesn't return counts, only
    // the covered flag + first-shortfall date + shortfall amount. To emit
    // obligations_checked we do one extra call. Cost is acceptable because
    // the underlying state+obligations are cached within a single
    // ForecastService instance (see service's `cachedState` comment).
    const [coverage, obs] = await Promise.all([
      this.service.areObligationsCovered(windowDays),
      this.service.getObligationsDueInWindow(windowDays),
    ]);

    const result: ObligationCoverageResult = {
      covered: coverage.covered,
      // Lossy but explicit: if any shortfall exists, we don't know which
      // specific obligations caused it without replaying the projection
      // day-by-day. Approximate: all obligations are "uncovered" when the
      // stream can't be fully served. Policy rules typically gate on the
      // `covered` flag itself, so the count is informational.
      obligations_checked: obs.length,
      obligations_uncovered: coverage.covered ? 0 : obs.length,
    };

    if (coverage.shortfallAmount !== undefined && coverage.shortfallAsset) {
      result.shortfall_amount = {
        amount: coverage.shortfallAmount.toString(),
        currency: coverage.shortfallAsset as AssetCode,
      };
    }
    if (coverage.firstShortfallDate) {
      result.first_shortfall_date = new Date(coverage.firstShortfallDate);
    }

    return result;
  }

  async getObligationsDueInWindow(windowDays: number): Promise<PolicyObligation[]> {
    const obs = await this.service.getObligationsDueInWindow(windowDays);
    return obs.map(toPolicyObligation);
  }

  hypothetical(proposedMovement: ProposedMovement): ForecastQuery {
    const transfer: ProposedTransfer = {
      amount: Number(proposedMovement.amount.amount),
      asset: proposedMovement.amount.asset,
      fromVenue: proposedMovement.source?.venue ?? null,
      toVenue: proposedMovement.destination?.venue ?? null,
    };
    return new RealForecastQuery(
      this.service.hypothetical([transfer]),
      this.metadata.snapshot_taken_at,
    );
  }
}

function toPolicyObligation(o: RealObligation): PolicyObligation {
  return {
    id: o.id,
    due_date: new Date(o.dueDate),
    amount: {
      amount: o.amount.toString(),
      currency: (o.asset ?? o.currency) as AssetCode,
    },
    description: o.label,
    counterparty_id: o.counterpartyId ?? undefined,
    source: mapSource(o.source),
  };
}

function mapSource(s: RealObligation['source']): PolicyObligation['source'] {
  switch (s) {
    case 'manual':
      return 'manual';
    case 'erp_sync':
      return 'erp_import';
    case 'recurring_rule':
      return 'recurring';
    default: {
      const _exhaustive: never = s;
      throw new Error(`Unhandled obligation source: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Production factory: wraps `createForecastService` with `consumer:
 * 'rules_engine'` and `persist: false`. The policy gate runs before
 * execution commits, so persisting a forecast snapshot per-gate-call
 * would bloat forecast_snapshots with evaluation-time rows.
 */
export class RealForecastQueryFactory implements ForecastQueryFactory {
  constructor(private readonly db: SupabaseClient) {}

  async createForEnterprise(enterpriseId: string): Promise<ForecastQuery> {
    const service = createForecastService({
      enterpriseId,
      db: this.db,
      consumer: 'rules_engine',
      persist: false,
    });
    return new RealForecastQuery(service);
  }
}
