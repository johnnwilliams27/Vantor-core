import { z } from 'zod';

// ─── Shared leaves ──────────────────────────────────────────────────────

const decimalString = z.string().regex(
  /^-?(\d+)(\.\d+)?$/,
  'Must be a decimal string'
);

const amountValueSchema = z.object({
  amount: decimalString,
  currency: z.string().min(1),
});

const numericOpSchema = z.enum(['>', '>=', '<', '<=', '==', '!=', 'between']);
const stringOpSchema  = z.enum(['==', '!=', 'in', 'not_in']);
const timeOpSchema    = z.enum(['==', '!=', '>', '>=', '<', '<=', 'in', 'not_in']);

// ─── Leaf node schemas ──────────────────────────────────────────────────

const amountCompareSchema = z
  .object({
    kind: z.literal('amount_compare'),
    attr: z.enum([
      'transfer.amount',
      'treasury.position',
      'treasury.post_position',
      'rolling_sum',
    ]),
    scope: z
      .object({
        asset: z.string().optional(),
        venue: z.string().optional(),
      })
      .optional(),
    op: numericOpSchema,
    value: amountValueSchema,
    value_upper: amountValueSchema.optional(),
  })
  .refine(
    (node) => node.op !== 'between' || node.value_upper !== undefined,
    { message: 'value_upper is required when op="between"' }
  );

const stringCompareSchema = z.object({
  kind: z.literal('string_compare'),
  attr: z.enum([
    'transfer.counterparty_id',
    'transfer.purpose_code',
    'transfer.initiator_type',
    'transfer.rail',
    'transfer.source_venue',
    'transfer.destination_venue',
  ]),
  op: stringOpSchema,
  value: z.union([z.string(), z.array(z.string()).nonempty()]),
});

const timeCompareSchema = z.object({
  kind: z.literal('time_compare'),
  attr: z.enum([
    'now.day_of_week',
    'now.hour_local',
    'now.is_business_hours',
    'time_since_last_to_counterparty',
    'time_since_last_by_initiator',
  ]),
  op: timeOpSchema,
  value: z.union([
    z.number(),
    z.string(),
    z.boolean(),
    z.array(z.union([z.number(), z.string()])),
  ]),
});

const sanctionsStatusSchema = z.object({
  kind: z.literal('sanctions_status'),
  op: z.enum(['in', 'not_in']),
  values: z.array(z.enum(['clear', 'sanctioned', 'partial_match', 'unscreened'])).nonempty(),
});

const forecastQuerySchema = z.object({
  kind: z.literal('forecast_query'),
  query: z.enum(['projected_min_balance', 'projected_position', 'obligations_covered']),
  window_days: z.number().int().positive(),
  scope: z
    .object({
      asset: z.string().optional(),
      venue: z.string().optional(),
    })
    .optional(),
  comparator: numericOpSchema,
  value: amountValueSchema,
});

const aggregateWindowSchema = z.object({
  kind: z.literal('aggregate_window'),
  window: z.object({
    duration_ms: z.number().int().positive(),
    group_by: z.object({
      initiator: z.boolean().optional(),
      counterparty: z.boolean().optional(),
      destination: z.boolean().optional(),
      asset: z.boolean().optional(),
    }),
    direction: z.enum(['outflow', 'inflow', 'both']).optional(),
  }),
  attr: z.enum([
    'sum_amount',
    'count',
    'distinct_destinations',
    'distinct_counterparties',
  ]),
  scope: z
    .object({
      asset: z.string().optional(),
    })
    .optional(),
  op: numericOpSchema,
  value: amountValueSchema,
});

// ─── Recursive union ────────────────────────────────────────────────────

// z.lazy for recursion. We have to declare the recursive type first.
// Using z.union instead of z.discriminatedUnion because amountCompareSchema
// uses .refine() which returns ZodEffects (not ZodObject), and
// discriminatedUnion requires plain ZodObject branches.
export const conditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('and'),
      children: z.array(conditionSchema).min(1, 'AND must have at least one child'),
    }),
    z.object({
      kind: z.literal('or'),
      children: z.array(conditionSchema).min(1, 'OR must have at least one child'),
    }),
    z.object({
      kind: z.literal('not'),
      child: conditionSchema,
    }),
    amountCompareSchema,
    stringCompareSchema,
    timeCompareSchema,
    sanctionsStatusSchema,
    forecastQuerySchema,
    aggregateWindowSchema,
  ])
);
