/**
 * Core types for the Treasury Insights Engine.
 *
 * The insights engine is the "intelligence" half of the agentic treasury
 * platform: detectors watch the treasury state and surface structured
 * recommendations to the treasurer for review and action. This module
 * never moves money — the rules engine and execution layer handle anything
 * that touches funds.
 *
 * Design principles (see plan file for full rationale):
 *   - Insights are recommendations, not actions.
 *   - Every insight is explainable (structured rationale + supporting data).
 *   - Risk profile shapes which detectors run and what thresholds apply.
 *   - Actionable insights are simulated through the policy engine before surfacing.
 *   - Deduplication is aggressive — insight fatigue is the biggest failure mode.
 */

import type { VenueCategory } from '@/lib/yield/venues';

// ─── Insight taxonomy ─────────────────────────────────────────────────

export type InsightType =
  | 'liquidity_below_buffer'
  | 'liquidity_idle_cash'
  | 'yield_drop'
  | 'yield_opportunity'
  | 'yield_idle_opportunity'
  | 'concentration_warning'
  | 'concentration_breach';

export type InsightSeverity = 'info' | 'warning' | 'critical';

export type InsightState = 'new' | 'viewed' | 'dismissed' | 'acted_on' | 'expired';

export type DataFreshness = 'fresh' | 'stale_under_10min' | 'stale_over_10min';

// ─── Policy verdict mirror ────────────────────────────────────────────

/**
 * Mirror of the Verdict enum from `feature/policy-engine`. The real type
 * will live at `@/lib/policy/types/verdict` once the policy engine lands
 * on master. Until then, we carry a local copy with the exact same shape
 * so a swap is one-line in `policy-gate.ts`.
 *
 * **Do not edit this list** — keep in sync with the policy engine.
 */
export type PolicyVerdict =
  | 'allow_auto'
  | 'require_approval'
  | 'block'
  | 'block_hard_limit';

/**
 * A proposed action that a detector wants the treasurer to take.
 * Shape mirrors the policy engine's planned `ProposedMovement` so it can
 * be passed directly to `evaluate()` without translation.
 *
 * v1 only models the action types a detector can actually propose —
 * yield_deposit, yield_withdraw, swap (for cross-venue rebalance), and
 * fx_convert (for cash rebalancing, though currency exposure is v1.5).
 */
export interface ProposedAction {
  type: 'yield_deposit' | 'yield_withdraw' | 'swap' | 'fx_convert' | 'transfer';
  /** Venue/account the funds move FROM (protocol ID, wallet ID, or bank account ID). */
  fromVenueId: string;
  /** Venue/account the funds move TO. */
  toVenueId: string;
  /** Asset symbol (USDC, USDT, USD, etc.). */
  asset: string;
  /** Native amount to move (not necessarily USD). */
  amount: number;
  /** USD equivalent of the amount, for quick policy checks. */
  amountUsd: number;
  /** Optional metadata the policy engine may use to route the decision. */
  metadata?: Record<string, unknown>;
}

// ─── Risk profile ─────────────────────────────────────────────────────

export type RiskProfileId = 'conservative' | 'balanced' | 'growth';

export type AumTier = 'starter' | 'growth' | 'scale' | 'enterprise';

export type CustomerKycTier = 'retail' | 'accredited' | 'qualified_purchaser';

// ─── Detector output ──────────────────────────────────────────────────

/**
 * A single insight produced by a detector, before persistence.
 * Detectors return arrays of these; the cron orchestrator persists them
 * via the store, calling dedup/cooldown checks along the way.
 */
export interface DetectedInsight {
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  /** Deterministic template-rendered summary. Claude reasoning lives elsewhere. */
  summary: string;

  /**
   * Structured data points that triggered the insight. Shape is detector-
   * specific — opaque JSONB to the DB and frontend.
   */
  rationale: Record<string, unknown>;

  /**
   * The action a detector proposes. Null if the insight is informational
   * only (e.g. a concentration warning that doesn't have a specific
   * rebalance target yet).
   */
  recommendedAction: ProposedAction | null;

  /** Impact estimates — all optional. */
  impact: {
    dollarValue?: number;
    apyDeltaBps?: number;
    bufferDays?: number;
  };

  /**
   * Stable hash used to suppress duplicate insights within the cooldown
   * window. Format is detector-specific but must be deterministic for the
   * same underlying state. Examples:
   *   'yield_opportunity:aave_v3:USDC:spiko_usd'
   *   'concentration_warning:protocol:morpho_steakhouse'
   *   'liquidity_below_buffer:USD'
   */
  dedupKey: string;

  /** Venue category involved, if applicable (drives UI treatment). */
  venueCategory?: VenueCategory;

  /** Freshness of the underlying data. Stale inputs downgrade severity. */
  dataFreshness: DataFreshness;

  /** Supporting market data snapshot for audit trail. */
  supportingData: Record<string, unknown>;

  /** Confidence score 0.00-1.00. Used by frontend for sort/filter. */
  confidence: number;
}

// ─── Persisted insight row ────────────────────────────────────────────

/**
 * Matches the `treasury_insights` table shape (see migration 0037).
 */
export interface TreasuryInsightRow {
  id: string;
  enterprise_id: string;
  user_id: string;
  detector_name: string;
  insight_type: InsightType;
  severity: InsightSeverity;
  state: InsightState;

  title: string;
  summary: string;
  ai_reasoning: string | null;
  ai_model: string | null;

  rationale: Record<string, unknown>;
  recommended_action: ProposedAction | null;
  policy_verdict: PolicyVerdict | null;
  policy_reason: string | null;

  impact_dollar_value: number | null;
  impact_apy_delta_bps: number | null;
  impact_buffer_days: number | null;
  confidence: number | null;

  venue_category: VenueCategory | null;
  data_freshness: DataFreshness;
  supporting_data: Record<string, unknown>;

  dedup_key: string;
  cooldown_until: string | null;

  created_at: string;
  updated_at: string;
  expires_at: string;
  viewed_at: string | null;
  dismissed_at: string | null;
  acted_on_at: string | null;
}
