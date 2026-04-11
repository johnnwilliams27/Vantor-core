import type { Obligation } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';

/**
 * Forecast scenario — mirrors the forecast_scenario enum in
 * supabase/migrations/0043_forecast_snapshots.sql. Keep both in sync.
 */
export type ForecastScenario = 'base' | 'conservative' | 'stress' | 'custom';

/**
 * Consumer label — mirrors the CHECK constraint on forecast_snapshots.consumer
 * in 0038. Keep both in sync.
 */
export type ForecastConsumer =
  | 'rules_engine'
  | 'agent_planner'
  | 'treasurer_view'
  | 'alert_eval'
  | 'analytics_view';

/**
 * FX handling strategy inside the projection. 'current' uses the rates
 * captured at snapshot time; 'pessimistic' shifts them by a bps delta;
 * 'fixed' overrides with a caller-supplied map.
 */
export type FxStrategy = 'current' | 'pessimistic' | 'fixed';

export interface CustomObligationOverride {
  /** Override an existing obligation in the window. */
  obligationId?: string;
  /** Inject a synthetic obligation into the window. */
  add?: Partial<Obligation> & {
    amount: number;
    currency: string;
    dueDate: string;
    direction: 'inflow' | 'outflow';
  };
  /** Remove an existing obligation from the window. */
  remove?: string;
}

export interface ScenarioParams {
  /** Include `expected` obligations in addition to `confirmed`. */
  includeExpected: boolean;
  /** Include `estimated` obligations on top of expected + confirmed. */
  includeEstimated: boolean;
  /** One-time day-0 outflow as a percentage of total base USD, 0-100. */
  extraDrawdownPct: number;
  fxStrategy: FxStrategy;
  /** Only used when fxStrategy === 'pessimistic'. */
  fxPessimisticBpsShift?: number;
  /** Only used when fxStrategy === 'fixed'. */
  fixedFxRates?: Record<string, number>;
  /** Only used when scenario === 'custom'. */
  customOverrides?: CustomObligationOverride[];
}

export interface ProjectionDay {
  date: string;
  /** Native amounts keyed by asset symbol (USD, USDC, USDT, EUR, ...). */
  balanceByAsset: Record<string, number>;
  /** Base USD value keyed by venue id. */
  balanceByVenue: Record<string, number>;
  totalBaseUsd: number;
}

export interface Shortfall {
  date: string;
  asset: string;
  venue: string | null;
  deficitAmount: number;
}

export interface Projection {
  daily: ProjectionDay[];
  minBalance: {
    date: string;
    totalBaseUsd: number;
    byAsset: Record<string, { amount: number; date: string }>;
  };
  shortfalls: Shortfall[];
  /**
   * True when no shortfall was detected across the window — the
   * obligation stream is fully covered by projected balances.
   */
  covered: boolean;
}

export interface ProposedTransfer {
  amount: number;
  asset: string;
  fromVenue: string | null;
  toVenue: string | null;
  /** ISO date (YYYY-MM-DD). Defaults to today when omitted. */
  executeOn?: string;
}

export interface ForecastSnapshot {
  id: string;
  enterpriseId: string;
  computedAt: string;
  computedBy: string | null;
  treasuryStateSnapshotId: string;
  scenario: ForecastScenario;
  scenarioParams: ScenarioParams;
  windowDays: number;
  obligationIds: string[];
  projection: Projection;
  correlationId: string | null;
  consumer: ForecastConsumer;
  isHypothetical: boolean;
  hypotheticalActions: ProposedTransfer[] | null;
}

export interface ComputeOptions {
  scenario?: ForecastScenario;
  scenarioParams?: Partial<ScenarioParams>;
  windowDays?: number;
  consumer: ForecastConsumer;
  correlationId?: string;
  /** Persist the computed snapshot into forecast_snapshots (default true). */
  persist?: boolean;
  /** Optional pre-computed state snapshot; when omitted, the service computes a fresh one. */
  treasuryState?: TreasuryStateSnapshot;
}
