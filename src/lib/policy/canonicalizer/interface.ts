// src/lib/policy/canonicalizer/interface.ts

import type { AssetCode } from '../types/assets';

/**
 * Dependency-injected rate source for the policy engine's canonicalizer.
 * The phase-1 implementation (CoingeckoPolicyRateProvider) wraps the
 * existing oracle. Future implementations can add additional sources
 * (ECB for EUR, Chainlink for ETH/BTC, etc.) without touching the
 * evaluator or any rule types.
 *
 * CRITICAL CONTRACT: implementations must NEVER return a stale or
 * fallback rate for policy purposes. If the underlying rate source is
 * unavailable, unreachable, or older than `max_age_ms`, the implementation
 * must throw a CanonicalizationError with a specific reason_code.
 *
 * Display code can and does use fallback rates (the existing oracle
 * falls back to 1.0). Policy decisions cannot.
 */
export interface PolicyRateProvider {
  /**
   * Returns a fresh rate converting `from` into `to` as of `asOf`.
   *
   * Contract:
   *   - MUST throw CanonicalizationError if the rate is unavailable
   *   - MUST throw CanonicalizationError if the rate is older than max_age_ms
   *   - MUST return a rate with `asOfRate` timestamp from the underlying source
   *   - MUST NOT use silent fallback values (even if display code does)
   */
  getRateAsOf(
    from: AssetCode,
    to: 'USD',
    asOf: Date,
  ): Promise<RateReading>;
}

export interface RateReading {
  rate: string;             // decimal string (e.g., "1.0002")
  source: string;           // identifier (e.g., 'coingecko' | 'ecb' | 'manual_override')
  asOfRate: Date;           // when the underlying rate was measured
  maxAgeMs: number;         // staleness threshold used for THIS reading
}

/**
 * Default max age for policy rate readings (60 seconds). Display code may
 * use longer windows; policy decisions require freshness within this
 * window or they fail.
 */
export const POLICY_RATE_MAX_AGE_MS = 60_000;
