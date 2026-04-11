// src/lib/policy/schemas/hard-limit.schema.ts
//
// Validates rows from policy_hard_limits. Uses .superRefine() to apply
// type-specific constraints (value range, integer-only for days, required
// scope.asset for native exposure). All primitives come from primitives.ts
// so the schema stays in lock-step with types/hard-limit.ts.

import { z } from 'zod';
import {
  decimalStringNonNegative,
  integerStringNonNegative,
  assetCodeSchema,
  hardLimitTypeSchema,
} from './primitives';

const hardLimitScopeSchema = z
  .object({
    asset: assetCodeSchema.optional(),
    venue: z.string().min(1).optional(),
    include_venues: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Base shape common to every hard limit row. Specific limit types layer
 * additional constraints on top via .superRefine().
 */
const baseHardLimitSchema = z
  .object({
    id: z.string().min(1),
    limit_type: hardLimitTypeSchema,
    name: z.string().min(1),
    limit_value: z.string().min(1),
    limit_currency: assetCodeSchema.optional(),
    scope: hardLimitScopeSchema,
  })
  .strict();

export const hardLimitSchema = baseHardLimitSchema.superRefine((row, ctx) => {
  const value = row.limit_value;

  // Non-negative decimal check for types whose value is a USD amount or
  // a native amount. max_single_asset_concentration_pct has its own
  // 0-100 range check below; obligation_coverage_days is integer-only.
  const nonNegativeDecimalTypes: Array<typeof row.limit_type> = [
    'min_cash_reserve_usd',
    'max_daily_outflow_usd',
    'max_30day_outflow_usd',
    'max_native_exposure',
  ];

  if (nonNegativeDecimalTypes.includes(row.limit_type)) {
    const result = decimalStringNonNegative.safeParse(value);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${row.limit_type} must be a non-negative decimal string`,
        path: ['limit_value'],
      });
    }
  }

  if (row.limit_type === 'max_single_asset_concentration_pct') {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'max_single_asset_concentration_pct must be a percentage in [0, 100]',
        path: ['limit_value'],
      });
    }
  }

  if (row.limit_type === 'obligation_coverage_days') {
    const intResult = integerStringNonNegative.safeParse(value);
    if (!intResult.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'obligation_coverage_days must be a non-negative integer string',
        path: ['limit_value'],
      });
    }
  }

  if (row.limit_type === 'max_native_exposure' && !row.scope.asset) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'max_native_exposure requires scope.asset to be specified',
      path: ['scope', 'asset'],
    });
  }
});

export type HardLimitInput = z.input<typeof hardLimitSchema>;
export type HardLimitParsed = z.output<typeof hardLimitSchema>;
