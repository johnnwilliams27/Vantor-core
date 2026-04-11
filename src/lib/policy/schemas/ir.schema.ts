// src/lib/policy/schemas/ir.schema.ts
//
// Recursive zod schema for the Condition IR. See types/ir.ts for the
// TypeScript discriminated union this mirrors.
//
// Uses z.union (not z.discriminatedUnion) because amountCompareSchema
// applies .refine() to enforce the "value_upper required when op=between"
// invariant, and zod's discriminatedUnion rejects ZodEffects branches.
//
// Recursion is depth-bounded via a factory function (see MAX_CONDITION_DEPTH
// below) to prevent stack-overflow DoS from pathological rule JSON. Cycles
// in arbitrary in-memory objects are also caught by the depth bound.

import { z } from 'zod';
import type { Condition } from '../types/ir';
import {
  amountValueSchema,
  numericOpSchema,
  stringOpSchema,
  timeOpSchema,
  amountAttributes,
  stringAttributes,
  timeAttributes,
  aggregateAttrs,
  forecastQueryKinds,
  sanctionsStatuses,
} from './primitives';

/**
 * Maximum nesting depth for Condition trees. 32 is far above any realistic
 * hand-authored rule (typical complex rules nest 3-5 levels) but low
 * enough to bound worst-case parse cost and prevent stack overflow.
 *
 * If the rule-builder UI ever needs deeper composition, raise this
 * deliberately — don't remove the bound.
 */
export const MAX_CONDITION_DEPTH = 32;

/**
 * Maximum aggregate-window duration. 90 days covers every phase-1
 * use case (max_30day_outflow is a hard limit, not a rule window).
 * Downstream Date math stays well-behaved within this bound.
 */
export const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Leaf schemas ───────────────────────────────────────────────────────

const amountCompareSchema = z
  .object({
    kind: z.literal('amount_compare'),
    attr: z.enum(amountAttributes),
    scope: z
      .object({
        asset: z.string().optional(),
        venue: z.string().optional(),
      })
      .strict()
      .optional(),
    op: numericOpSchema,
    value: amountValueSchema,
    value_upper: amountValueSchema.optional(),
  })
  .strict()
  .refine(
    (node) => node.op !== 'between' || node.value_upper !== undefined,
    { message: 'value_upper is required when op="between"' },
  );

const stringCompareSchema = z
  .object({
    kind: z.literal('string_compare'),
    attr: z.enum(stringAttributes),
    op: stringOpSchema,
    value: z.union([z.string(), z.array(z.string()).nonempty()]),
  })
  .strict();

const timeCompareSchema = z
  .object({
    kind: z.literal('time_compare'),
    attr: z.enum(timeAttributes),
    op: timeOpSchema,
    value: z.union([
      z.number(),
      z.string(),
      z.boolean(),
      z.array(z.union([z.number(), z.string()])),
    ]),
  })
  .strict();

const sanctionsStatusSchema = z
  .object({
    kind: z.literal('sanctions_status'),
    op: z.enum(['in', 'not_in']),
    values: z.array(z.enum(sanctionsStatuses)).nonempty(),
  })
  .strict();

const forecastQuerySchema = z
  .object({
    kind: z.literal('forecast_query'),
    query: z.enum(forecastQueryKinds),
    window_days: z.number().int().positive(),
    scope: z
      .object({
        asset: z.string().optional(),
        venue: z.string().optional(),
      })
      .strict()
      .optional(),
    comparator: numericOpSchema,
    value: amountValueSchema,
  })
  .strict();

const aggregateWindowSchema = z
  .object({
    kind: z.literal('aggregate_window'),
    window: z
      .object({
        duration_ms: z
          .number()
          .int()
          .positive()
          .max(MAX_WINDOW_MS, `Window duration must not exceed ${MAX_WINDOW_MS} ms`),
        group_by: z
          .object({
            initiator: z.boolean().optional(),
            counterparty: z.boolean().optional(),
            destination: z.boolean().optional(),
            asset: z.boolean().optional(),
          })
          .strict(),
        direction: z.enum(['outflow', 'inflow', 'both']).optional(),
      })
      .strict(),
    attr: z.enum(aggregateAttrs),
    scope: z
      .object({
        asset: z.string().optional(),
      })
      .strict()
      .optional(),
    op: numericOpSchema,
    value: amountValueSchema,
  })
  .strict();

// ─── Recursive union factory (depth-bounded) ────────────────────────────

function makeConditionSchema(depth: number): z.ZodType<Condition> {
  if (depth > MAX_CONDITION_DEPTH) {
    return z
      .never({ invalid_type_error: `Condition nesting exceeds max depth of ${MAX_CONDITION_DEPTH}` })
      .refine(() => false, { message: `Condition nesting exceeds max depth of ${MAX_CONDITION_DEPTH}` }) as unknown as z.ZodType<Condition>;
  }

  const child: z.ZodType<Condition> = z.lazy(() => makeConditionSchema(depth + 1));

  return z.union([
    z
      .object({
        kind: z.literal('and'),
        children: z.array(child).min(1, 'AND must have at least one child'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('or'),
        children: z.array(child).min(1, 'OR must have at least one child'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('not'),
        child,
      })
      .strict(),
    amountCompareSchema,
    stringCompareSchema,
    timeCompareSchema,
    sanctionsStatusSchema,
    forecastQuerySchema,
    aggregateWindowSchema,
  ]) as unknown as z.ZodType<Condition>;
}

/**
 * The public recursive Condition schema. Parses to `Condition` from
 * types/ir.ts. Callers can use `conditionSchema.safeParse(unknown)` to
 * validate rule JSON at API boundaries.
 */
export const conditionSchema: z.ZodType<Condition> = makeConditionSchema(0);
