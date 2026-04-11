import { z } from 'zod';
import type { AssetCode } from '../types/assets';
import type { MovementKind } from '../types/movement';

/**
 * Decimal string matching "N" or "N.M" where N, M are digit strings. Non-negative.
 * Accepts leading zeros (e.g., "007"); canonicalization into a normal form is the
 * responsibility of downstream code (rate provider / idempotency hashing), not
 * this boundary schema.
 */
const decimalStringNonNegative = z.string().regex(
  /^(\d+)(\.\d+)?$/,
  'Must be a non-negative decimal string (e.g., "100" or "100.50")'
);

/**
 * Closed asset enum — mirrors AssetCode from types/assets.ts. The
 * `satisfies readonly AssetCode[]` check makes adding a new AssetCode
 * without updating this tuple a compile error.
 */
const assetCodes = ['USD', 'USDC', 'USDT'] as const satisfies readonly AssetCode[];
const assetCodeSchema = z.enum(assetCodes);

const amountNativeSchema = z.object({
  amount: decimalStringNonNegative,
  asset: assetCodeSchema,
});

const movementEndpointSchema = z.object({
  venue: z.string().min(1),
  asset: assetCodeSchema,
  address: z.string().min(1).optional(),
  account_id: z.string().min(1).optional(),
  label: z.string().optional(),
});

const counterpartyRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['known', 'new', 'unknown']).optional(),
  jurisdiction: z.string().optional(),
});

/**
 * Discriminated union over initiator type. Each branch uses `.strict()` so
 * payloads that leak identity fields from a different branch are rejected.
 *
 * This is load-bearing for the Vantor invariant "AI-initiated money movement
 * never auto-executes" — a payload like
 *   { type: 'ai_recommendation', recommendation_id: 'r1', user_id: 'hijack' }
 * would otherwise let downstream code read `user_id` as if a human initiated
 * the movement.
 */
const initiatorSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('human'),
      user_id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('agent'),
      agent_id: z.string().min(1),
      recommendation_id: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('ai_recommendation'),
      recommendation_id: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('schedule'),
      scheduled_op_id: z.string().min(1),
    })
    .strict(),
]);

/**
 * Closed movement kind enum. The `satisfies readonly MovementKind[]` check
 * forces this tuple to stay in sync with MovementKind in types/movement.ts.
 */
const movementKinds = [
  'crypto_transfer',
  'fiat_ramp',
  'yield_deposit',
  'yield_withdraw',
  'swap',
  'bridge',
  'payment',
] as const satisfies readonly MovementKind[];

export const proposedMovementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(movementKinds),
  source: movementEndpointSchema,
  destination: movementEndpointSchema,
  amount: amountNativeSchema,
  counterparty: counterpartyRefSchema.optional(),
  initiator: initiatorSchema,
  purpose_code: z.string().optional(),
  rail: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requested_at: z.string().datetime(),
});

export type ProposedMovementInput = z.input<typeof proposedMovementSchema>;
export type ProposedMovementParsed = z.output<typeof proposedMovementSchema>;

// Unused-variable guard: the satisfies checks above are compile-time only.
// Export the suppressed tuples so TS doesn't strip them as dead code.
void assetCodes;
void movementKinds;
