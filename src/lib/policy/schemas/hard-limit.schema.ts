// src/lib/policy/schemas/hard-limit.schema.ts
//
// Validates rows from policy_hard_limits. Uses .superRefine() with an
// exhaustive switch over HardLimitType so adding a new limit type becomes
// a compile error here until the refine is updated.
//
// All primitive checks go through the shared primitives module, which
// means parseFloat / Number coercion garbage (e.g. "50foo") is rejected
// at the regex layer before any numeric comparison runs.
//
// Cross-field invariants enforced:
//   - monetary types (*_usd) require limit_currency='USD'
//   - non-monetary types (concentration_pct, coverage_days) require
//     limit_currency=undefined
//   - max_native_exposure requires scope.asset AND limit_currency set
//     (can be USD for USD-caps on a native position, or the native asset)

import { z } from 'zod';
import {
  decimalStringNonNegative,
  integerStringNonNegative,
  assetCodeSchema,
  hardLimitTypeSchema,
} from './primitives';
import type { HardLimitType } from '../types/hard-limit';

/** Ceilings that prevent authoring-time nonsense and downstream math underflow. */
const MAX_MONETARY_USD = '1000000000000000'; // 1e15 USD — covers any real treasury
const MAX_COVERAGE_DAYS = 365;
const MAX_NATIVE_EXPOSURE_DECIMAL_DIGITS = 30; // guard against 100-digit decimal strings

const hardLimitScopeSchema = z
  .object({
    asset: assetCodeSchema.optional(),
    venue: z.string().min(1).optional(),
    include_venues: z.array(z.string().min(1)).min(1).optional(),
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

function parseNonNegativeDecimalOrIssue(
  ctx: z.RefinementCtx,
  value: string,
  limitType: string,
): number | undefined {
  const strResult = decimalStringNonNegative.safeParse(value);
  if (!strResult.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${limitType} must be a non-negative decimal string`,
      path: ['limit_value'],
    });
    return undefined;
  }
  // At this point value is /^(\d+)(\.\d+)?$/. Parse via Number — safe now.
  // Guard against silently dropping precision on astronomical inputs by
  // rejecting decimals with too many digits before downstream math sees them.
  const totalDigits = value.replace('.', '').length;
  if (totalDigits > MAX_NATIVE_EXPOSURE_DECIMAL_DIGITS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${limitType} exceeds maximum precision (${MAX_NATIVE_EXPOSURE_DECIMAL_DIGITS} digits)`,
      path: ['limit_value'],
    });
    return undefined;
  }
  return Number(value);
}

export const hardLimitSchema = baseHardLimitSchema.superRefine((row, ctx) => {
  // Exhaustive switch — TypeScript enforces that every HardLimitType is handled.
  // Adding a new value to HardLimitType without adding a case here produces
  // a compile error on the `_exhaustive: never` assignment at the bottom.
  switch (row.limit_type) {
    case 'min_cash_reserve_usd':
    case 'max_daily_outflow_usd':
    case 'max_30day_outflow_usd': {
      const parsed = parseNonNegativeDecimalOrIssue(ctx, row.limit_value, row.limit_type);
      if (parsed !== undefined) {
        if (parsed === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${row.limit_type} must be greater than zero (a limit of 0 is a total freeze — use a rule instead)`,
            path: ['limit_value'],
          });
        }
        if (Number(MAX_MONETARY_USD) < parsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${row.limit_type} exceeds maximum allowed value (${MAX_MONETARY_USD})`,
            path: ['limit_value'],
          });
        }
      }
      if (row.limit_currency !== 'USD') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${row.limit_type} requires limit_currency='USD'`,
          path: ['limit_currency'],
        });
      }
      break;
    }

    case 'max_single_asset_concentration_pct': {
      const parsed = parseNonNegativeDecimalOrIssue(ctx, row.limit_value, row.limit_type);
      if (parsed !== undefined && parsed > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'max_single_asset_concentration_pct must be in [0, 100]',
          path: ['limit_value'],
        });
      }
      if (row.limit_currency !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'max_single_asset_concentration_pct must not set limit_currency (percentage has no currency)',
          path: ['limit_currency'],
        });
      }
      break;
    }

    case 'obligation_coverage_days': {
      const intResult = integerStringNonNegative.safeParse(row.limit_value);
      if (!intResult.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'obligation_coverage_days must be a non-negative integer string',
          path: ['limit_value'],
        });
      } else {
        const days = Number(row.limit_value);
        if (days < 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'obligation_coverage_days must be at least 1',
            path: ['limit_value'],
          });
        }
        if (days > MAX_COVERAGE_DAYS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `obligation_coverage_days must not exceed ${MAX_COVERAGE_DAYS}`,
            path: ['limit_value'],
          });
        }
      }
      if (row.limit_currency !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'obligation_coverage_days must not set limit_currency (duration has no currency)',
          path: ['limit_currency'],
        });
      }
      break;
    }

    case 'max_native_exposure': {
      const parsed = parseNonNegativeDecimalOrIssue(ctx, row.limit_value, row.limit_type);
      if (parsed !== undefined && parsed === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'max_native_exposure must be greater than zero',
          path: ['limit_value'],
        });
      }
      if (!row.scope.asset) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'max_native_exposure requires scope.asset to be specified',
          path: ['scope', 'asset'],
        });
      }
      if (row.limit_currency === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'max_native_exposure requires limit_currency to be set (either USD or the native asset)',
          path: ['limit_currency'],
        });
      }
      break;
    }

    default: {
      // Exhaustiveness guard — compile error if a new HardLimitType is added
      // without a case above. DO NOT remove.
      const _exhaustive: never = row.limit_type;
      void _exhaustive;
    }
  }
});

export type HardLimitInput = z.input<typeof hardLimitSchema>;
export type HardLimitParsed = z.output<typeof hardLimitSchema>;

// Touch HardLimitType so TS doesn't strip the import
type _HardLimitType = HardLimitType;
