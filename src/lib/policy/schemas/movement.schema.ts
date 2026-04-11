import { z } from 'zod';

/** Decimal string matching "N" or "N.M" where N, M are digit strings. Non-negative. */
const decimalStringNonNegative = z.string().regex(
  /^(\d+)(\.\d+)?$/,
  'Must be a non-negative decimal string (e.g., "100" or "100.50")'
);

const amountNativeSchema = z.object({
  amount: decimalStringNonNegative,
  asset: z.string().min(1),
});

const movementEndpointSchema = z.object({
  venue: z.string().min(1),
  asset: z.string().min(1),
  address: z.string().optional(),
  account_id: z.string().optional(),
  label: z.string().optional(),
});

const counterpartyRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['known', 'new', 'unknown']).optional(),
  jurisdiction: z.string().optional(),
});

const initiatorSchema = z
  .object({
    type: z.enum(['human', 'agent', 'ai_recommendation', 'schedule']),
    user_id: z.string().optional(),
    agent_id: z.string().optional(),
    recommendation_id: z.string().optional(),
    scheduled_op_id: z.string().optional(),
  })
  .refine(
    (init) => {
      switch (init.type) {
        case 'human':             return !!init.user_id;
        case 'agent':              return !!init.agent_id;
        case 'ai_recommendation':  return !!init.recommendation_id;
        case 'schedule':           return !!init.scheduled_op_id;
      }
    },
    {
      message: 'Initiator identity field must match type: human→user_id, agent→agent_id, ai_recommendation→recommendation_id, schedule→scheduled_op_id',
    }
  );

export const proposedMovementSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'crypto_transfer',
    'fiat_ramp',
    'yield_deposit',
    'yield_withdraw',
    'swap',
    'bridge',
    'payment',
  ]),
  source: movementEndpointSchema,
  destination: movementEndpointSchema,
  amount: amountNativeSchema,
  counterparty: counterpartyRefSchema.optional(),
  initiator: initiatorSchema,
  purpose_code: z.string().optional(),
  rail: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  requested_at: z.string().datetime(),
});

export type ProposedMovementInput = z.input<typeof proposedMovementSchema>;
export type ProposedMovementParsed = z.output<typeof proposedMovementSchema>;
