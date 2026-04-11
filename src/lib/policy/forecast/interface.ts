// src/lib/policy/forecast/interface.ts

import { AssetCode, AmountNative, AmountValue, VenueId } from '../types/assets';
import { ProposedMovement } from '../types/movement';
import { ForecastQueryMetadata } from '../types/context';

// Re-export ForecastQueryMetadata so consumers of the forecast module can
// import it from a single location. The canonical definition lives in
// types/context.ts because ForecastSnapshot references it there.
export type { ForecastQueryMetadata };

/**
 * Read-only forecast query surface consumed by the policy engine.
 *
 * The interface is pure in the sense that a single query instance
 * represents a single snapshot — calling methods multiple times on
 * the same instance returns consistent results.
 *
 * hypothetical() is the post-state mechanism: returns a NEW query
 * scoped to post-transfer state, independent of the original.
 */
export interface ForecastQuery {
  getProjectedMinBalance(
    asset: AssetCode,
    venue: VenueId | null,
    windowDays: number
  ): Promise<AmountNative>;

  getProjectedPosition(
    asset: AssetCode,
    venue: VenueId | null,
    atDate: Date
  ): Promise<AmountNative>;

  areObligationsCovered(
    windowDays: number
  ): Promise<ObligationCoverageResult>;

  getObligationsDueInWindow(
    windowDays: number
  ): Promise<Obligation[]>;

  /**
   * Returns a NEW query scoped to treasury state AFTER the proposed
   * movement is applied. Must not mutate `this`.
   */
  hypothetical(proposedMovement: ProposedMovement): ForecastQuery;

  readonly metadata: ForecastQueryMetadata;
}

export interface ObligationCoverageResult {
  covered: boolean;
  shortfall_amount?: AmountValue;
  first_shortfall_date?: Date;
  obligations_checked: number;
  obligations_uncovered: number;
}

export interface Obligation {
  id: string;
  due_date: Date;
  amount: AmountValue;
  description: string;
  counterparty_id?: string;
  source: 'manual' | 'recurring' | 'erp_import';
}

/**
 * Factory that produces ForecastQuery instances. Dependency-injected
 * at context-loader wiring time so stub and real implementations are
 * swappable without touching the evaluator.
 */
export interface ForecastQueryFactory {
  createForEnterprise(enterpriseId: string): Promise<ForecastQuery>;
}
