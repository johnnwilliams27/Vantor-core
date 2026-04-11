// src/lib/policy/schemas/primitives.ts
//
// Shared zod primitives for policy engine schemas. Every schema that
// validates monetary amounts or asset codes should import from here
// rather than rolling its own — see Task 6 code review for the drift
// history that motivated this file.

import { z } from 'zod';
import type { AssetCode } from '../types/assets';
import type { HardLimitType } from '../types/hard-limit';
import type { MovementKind } from '../types/movement';
import type {
  AmountAttribute,
  StringAttribute,
  TimeAttribute,
  AggregateAttr,
  ForecastQueryKind,
  SanctionsStatus,
  NumericOp,
  StringOp,
  TimeOp,
} from '../types/ir';

/**
 * Decimal string matching "N" or "N.M". Non-negative only — phase-1 policy
 * attributes (transfer.amount, treasury.position, rolling_sum) are all
 * non-negative. If future attributes need signed values (e.g., forecast
 * deltas) introduce a separate decimalStringSigned primitive and use it
 * explicitly at the leaf that needs it.
 *
 * Accepts leading zeros (e.g., "007"); canonicalization is downstream.
 */
export const decimalStringNonNegative = z.string().regex(
  /^(\d+)(\.\d+)?$/,
  'Must be a non-negative decimal string (e.g., "100" or "100.50")',
);

/** Integer decimal string — non-negative, no fractional part. */
export const integerStringNonNegative = z.string().regex(
  /^\d+$/,
  'Must be a non-negative integer string',
);

// ─── Asset codes ────────────────────────────────────────────────────────

/**
 * Closed tuple — the `satisfies readonly AssetCode[]` clause makes adding
 * a new AssetCode in types/assets.ts a compile error here until this tuple
 * is updated.
 */
export const assetCodes = ['USD', 'USDC', 'USDT'] as const satisfies readonly AssetCode[];
export const assetCodeSchema = z.enum(assetCodes);
void assetCodes;

// ─── Money shapes ───────────────────────────────────────────────────────

export const amountNativeSchema = z
  .object({
    amount: decimalStringNonNegative,
    asset: assetCodeSchema,
  })
  .strict();

export const amountValueSchema = z
  .object({
    amount: decimalStringNonNegative,
    currency: assetCodeSchema,
  })
  .strict();

// ─── IR attribute / op tuples ───────────────────────────────────────────

export const amountAttributes = [
  'transfer.amount',
  'treasury.position',
  'treasury.post_position',
  'rolling_sum',
] as const satisfies readonly AmountAttribute[];
void amountAttributes;

export const stringAttributes = [
  'transfer.counterparty_id',
  'transfer.purpose_code',
  'transfer.initiator_type',
  'transfer.rail',
  'transfer.source_venue',
  'transfer.destination_venue',
] as const satisfies readonly StringAttribute[];
void stringAttributes;

export const timeAttributes = [
  'now.day_of_week',
  'now.hour_local',
  'now.is_business_hours',
  'time_since_last_to_counterparty',
  'time_since_last_by_initiator',
] as const satisfies readonly TimeAttribute[];
void timeAttributes;

export const aggregateAttrs = [
  'sum_amount',
  'count',
  'distinct_destinations',
  'distinct_counterparties',
] as const satisfies readonly AggregateAttr[];
void aggregateAttrs;

export const forecastQueryKinds = [
  'projected_min_balance',
  'projected_position',
  'obligations_covered',
] as const satisfies readonly ForecastQueryKind[];
void forecastQueryKinds;

export const sanctionsStatuses = [
  'clear',
  'sanctioned',
  'partial_match',
  'unscreened',
] as const satisfies readonly SanctionsStatus[];
void sanctionsStatuses;

export const numericOps = ['>', '>=', '<', '<=', '==', '!=', 'between'] as const satisfies readonly NumericOp[];
void numericOps;

export const stringOps = ['==', '!=', 'in', 'not_in'] as const satisfies readonly StringOp[];
void stringOps;

export const timeOps = ['==', '!=', '>', '>=', '<', '<=', 'in', 'not_in'] as const satisfies readonly TimeOp[];
void timeOps;

export const numericOpSchema = z.enum(numericOps);
export const stringOpSchema = z.enum(stringOps);
export const timeOpSchema = z.enum(timeOps);

// ─── Movement kind tuple (for movement.schema.ts) ───────────────────────

export const movementKinds = [
  'crypto_transfer',
  'fiat_ramp',
  'yield_deposit',
  'yield_withdraw',
  'swap',
  'bridge',
  'payment',
] as const satisfies readonly MovementKind[];
void movementKinds;

// ─── Hard limit type tuple (for hard-limit.schema.ts) ───────────────────

export const hardLimitTypes = [
  'min_cash_reserve_usd',
  'max_single_asset_concentration_pct',
  'max_daily_outflow_usd',
  'max_30day_outflow_usd',
  'obligation_coverage_days',
  'max_native_exposure',
] as const satisfies readonly HardLimitType[];
void hardLimitTypes;

export const hardLimitTypeSchema = z.enum(hardLimitTypes);
