import { z } from 'zod';
import {
  assetCodeSchema,
  amountNativeSchema,
  movementKinds,
} from './primitives';

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
