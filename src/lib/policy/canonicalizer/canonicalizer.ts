// src/lib/policy/canonicalizer/canonicalizer.ts

import Big from 'big.js';
import { AmountNative, AssetCode } from '../types/assets';
import { CanonicalizationResult, CanonicalizationFailure } from '../types/context';
import { PolicyRateProvider, RateReading } from './interface';
import { CanonicalizationError } from '../errors/classes';

/**
 * Canonicalize a native amount to USD via the provided rate provider.
 *
 * Never throws — returns a structured CanonicalizationResult with a
 * populated `failure` field on any error. The evaluator calls this once
 * per movement at context-load time, and consumers read the result from
 * the EvaluationContext synchronously.
 *
 * The catch branch on `CanonicalizationError` handles all three subclasses
 * generically (CanonicalizationError, CanonicalizationSourceUnavailableError,
 * CanonicalizationRateStaleError) because the latter two extend
 * CanonicalizationError — see src/lib/policy/errors/classes.ts.
 */
export async function canonicalizeToUsd(
  amount: AmountNative,
  provider: PolicyRateProvider,
  asOf: Date,
): Promise<CanonicalizationResult> {
  try {
    const rateReading = await provider.getRateAsOf(amount.asset, 'USD', asOf);
    return buildCanonicalizationResult({
      nativeAmount: amount.amount,
      nativeAsset: amount.asset,
      rateReading,
    });
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return buildCanonicalizationResult({
        nativeAmount: amount.amount,
        nativeAsset: amount.asset,
        error: err,
      });
    }
    // Unexpected error — wrap it
    return buildCanonicalizationResult({
      nativeAmount: amount.amount,
      nativeAsset: amount.asset,
      error: new CanonicalizationError({
        human_readable: `Unexpected error during canonicalization: ${err instanceof Error ? err.message : String(err)}`,
        user_action: 'Contact support with the trace ID.',
        details: { unexpected_error_class: err instanceof Error ? err.name : typeof err },
      }),
    });
  }
}

/**
 * Pure builder that assembles a CanonicalizationResult from either a
 * successful rate reading or an error. Separated from canonicalizeToUsd
 * so it can be unit-tested without mocking the provider.
 */
export function buildCanonicalizationResult(
  opts:
    | {
        nativeAmount: string;
        nativeAsset: AssetCode;
        rateReading: RateReading;
        error?: never;
      }
    | {
        nativeAmount: string;
        nativeAsset: AssetCode;
        error: CanonicalizationError;
        rateReading?: never;
      },
): CanonicalizationResult {
  if (opts.error) {
    // The cast narrows the broad ReasonCode union on PolicyError down to the
    // three canonicalization reason codes accepted by CanonicalizationFailure.
    // Safe because the only error types that reach this path are
    // CanonicalizationError and its two subclasses, all of which carry one of
    // those three codes.
    const failure: CanonicalizationFailure = {
      reason_code: opts.error.reason_code as CanonicalizationFailure['reason_code'],
      human_readable: opts.error.human_readable,
      details: opts.error.details,
      user_action: opts.error.user_action,
    };
    return {
      native_amount: opts.nativeAmount,
      native_asset: opts.nativeAsset,
      canonical_amount: '',
      canonical_currency: 'USD',
      rate: '',
      rate_source: '',
      rate_as_of: new Date(0),
      max_age_ms: 0,
      failure,
    };
  }

  const { rateReading } = opts;
  const canonical = new Big(opts.nativeAmount).times(new Big(rateReading.rate)).toString();

  return {
    native_amount: opts.nativeAmount,
    native_asset: opts.nativeAsset,
    canonical_amount: canonical,
    canonical_currency: 'USD',
    rate: rateReading.rate,
    rate_source: rateReading.source,
    rate_as_of: rateReading.asOfRate,
    max_age_ms: rateReading.maxAgeMs,
  };
}
