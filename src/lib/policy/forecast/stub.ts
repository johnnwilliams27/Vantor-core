// src/lib/policy/forecast/stub.ts

import {
  ForecastQuery,
  ForecastQueryFactory,
  ForecastQueryMetadata,
  Obligation,
  ObligationCoverageResult,
} from './interface';
import { StubLogger } from './stub-logger';
import { AssetCode, AmountNative, VenueId } from '../types/assets';
import { ProposedMovement } from '../types/movement';

/**
 * Pass-through stub for the ForecastQuery interface.
 *
 * Returns permissive defaults — "all obligations covered, no shortfall,
 * infinite projected balances, no obligations due" — and logs every call.
 *
 * SAFETY CONTRACT: Never returns a conservative answer that would wrongly
 * block a transfer. Always the most permissive answer so forecast-dependent
 * checks fail open with loud signaling.
 *
 * DELETION: When the real forecast module ships, delete this file and
 * stub-logger.ts, then update the single DI wiring line in src/lib/policy/gate.ts.
 * The evaluation trace's forecast_mode='stub' flag will stop appearing on
 * new evaluations, and UI advisory badges auto-disappear.
 */
const STUB_WARNING_MESSAGE =
  'FORECAST_STUB_MODE: This query instance is served by the stub. ' +
  'Forecast-dependent checks (obligation coverage, lookahead rules, ' +
  'projected min balance) are advisory only until the real forecast ' +
  'module is deployed.';

const LARGE_PERMISSIVE_AMOUNT = '999999999999999999';

export class StubForecastQuery implements ForecastQuery {
  readonly metadata: ForecastQueryMetadata;

  constructor(
    private readonly enterpriseId: string,
    private readonly logger: StubLogger,
    snapshotTime: Date = new Date(),
  ) {
    this.metadata = {
      mode: 'stub',
      snapshot_taken_at: snapshotTime,
      source: 'stub-pass-through',
      warnings: [STUB_WARNING_MESSAGE],
    };
  }

  async getProjectedMinBalance(
    asset: AssetCode,
    venue: VenueId | null,
    windowDays: number,
  ): Promise<AmountNative> {
    this.logger.logStubCall('getProjectedMinBalance', this.enterpriseId, {
      asset,
      venue,
      windowDays,
    });
    return { amount: LARGE_PERMISSIVE_AMOUNT, asset };
  }

  async getProjectedPosition(
    asset: AssetCode,
    venue: VenueId | null,
    atDate: Date,
  ): Promise<AmountNative> {
    this.logger.logStubCall('getProjectedPosition', this.enterpriseId, {
      asset,
      venue,
      atDate: atDate.toISOString(),
    });
    return { amount: LARGE_PERMISSIVE_AMOUNT, asset };
  }

  async areObligationsCovered(windowDays: number): Promise<ObligationCoverageResult> {
    this.logger.logStubCall('areObligationsCovered', this.enterpriseId, { windowDays });
    return {
      covered: true,
      obligations_checked: 0,
      obligations_uncovered: 0,
    };
  }

  async getObligationsDueInWindow(windowDays: number): Promise<Obligation[]> {
    this.logger.logStubCall('getObligationsDueInWindow', this.enterpriseId, { windowDays });
    return [];
  }

  hypothetical(proposedMovement: ProposedMovement): ForecastQuery {
    this.logger.logStubCall('hypothetical', this.enterpriseId, {
      movement_id: proposedMovement.id,
    });
    // Recursive stub — the post-state query is indistinguishable from the
    // original (stub ignores state entirely) but it's a new instance so
    // hypo calls don't interfere with origin calls.
    return new StubForecastQuery(
      this.enterpriseId,
      this.logger,
      this.metadata.snapshot_taken_at,
    );
  }
}

/**
 * Factory for StubForecastQuery instances. Wired into the context loader
 * in Plan 2 via DI.
 */
export class StubForecastQueryFactory implements ForecastQueryFactory {
  constructor(private readonly logger: StubLogger) {}

  async createForEnterprise(enterpriseId: string): Promise<ForecastQuery> {
    return new StubForecastQuery(enterpriseId, this.logger);
  }
}
