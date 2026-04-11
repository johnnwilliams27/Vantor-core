// src/lib/policy/canonicalizer/coingecko-provider.ts

import { PolicyRateProvider, RateReading, POLICY_RATE_MAX_AGE_MS } from './interface';
import {
  CanonicalizationError,
  CanonicalizationSourceUnavailableError,
  CanonicalizationRateStaleError,
} from '../errors/classes';
import { AssetCode } from '../types/assets';
import { decimalStringNonNegative } from '../schemas/primitives';

/**
 * Minimal dependency for fetching stablecoin prices. Matches the shape of
 * the existing `getStablecoinPrices()` from src/lib/treasury/oracle.ts but
 * adds a `fetchedAt` timestamp so freshness can be enforced (the existing
 * oracle relies on Next.js's cache layer and doesn't expose this).
 *
 * The adapter in src/lib/policy/canonicalizer/oracle-adapter.ts (added in
 * Task 10) wraps the existing oracle and attaches fetchedAt=new Date() at
 * every call, which means phase 1 always considers the rate "just fetched"
 * and never hits the rate_stale path under normal operation. The test for
 * rate_stale exercises the code path via direct DI, not via the oracle.
 */
export interface StablecoinPricesResult {
  prices: Record<AssetCode, number>;
  /**
   * Free-form identifier of the rate source (e.g., 'coingecko', 'mock').
   * Validated against an explicit allowlist in the provider — see
   * PRODUCTION_ACCEPTED_SOURCES below. Adding a new source is an opt-in
   * decision that must update the allowlist.
   */
  source: string;
  fetchedAt: Date;
}

export interface CoingeckoPolicyRateProviderOpts {
  fetchStablecoinPrices: () => Promise<StablecoinPricesResult>;

  /**
   * Whether to accept rate readings where `source='mock'` (the existing
   * oracle's mock mode). Default false in production; set true via env
   * wiring in dev/test so local development works without a real
   * CoinGecko connection.
   */
  acceptMockSource?: boolean;
}

/**
 * Closed allowlist of supported asset codes. `new Set<AssetCode>(...)` forces
 * TypeScript to check the literal members against the AssetCode union, so a
 * typo becomes a compile error instead of a silent runtime bug.
 */
const SUPPORTED_ASSETS = new Set<AssetCode>(['USD', 'USDC', 'USDT']);

/**
 * Source allowlists — explicit opt-in, not mock-blacklist. Any source string
 * the oracle might return that is NOT in the active allowlist is rejected as
 * source_unavailable. This means new sources (cache, fallback, stub, ...)
 * can't silently pass policy validation — they have to be explicitly added.
 */
const PRODUCTION_ACCEPTED_SOURCES: ReadonlySet<string> = new Set(['coingecko']);
const DEV_ACCEPTED_SOURCES: ReadonlySet<string> = new Set(['coingecko', 'mock']);

/**
 * Phase-1 policy rate provider. Supports USDC, USDT, and USD passthrough.
 * Wraps the existing treasury oracle via an adapter.
 *
 * Failure modes (each has its own top-level reason_code):
 *   - unsupported asset                  → CanonicalizationError (canonicalization_failed)
 *   - oracle fetcher throws              → CanonicalizationSourceUnavailableError
 *   - source not in allowlist            → CanonicalizationSourceUnavailableError
 *   - fetchedAt in the future            → CanonicalizationSourceUnavailableError
 *   - reading older than max_age_ms      → CanonicalizationRateStaleError
 *   - missing / non-finite rate          → CanonicalizationError
 *   - rate fails decimal string validate → CanonicalizationError
 */
export class CoingeckoPolicyRateProvider implements PolicyRateProvider {
  private readonly acceptedSources: ReadonlySet<string>;

  constructor(private readonly opts: CoingeckoPolicyRateProviderOpts) {
    this.acceptedSources = opts.acceptMockSource
      ? DEV_ACCEPTED_SOURCES
      : PRODUCTION_ACCEPTED_SOURCES;
  }

  async getRateAsOf(
    from: AssetCode,
    to: 'USD',
    _asOf: Date,
  ): Promise<RateReading> {
    // USD → USD is always 1.0 with no source fetch
    if (from === 'USD' && to === 'USD') {
      return {
        rate: '1',
        source: 'passthrough',
        asOfRate: new Date(),
        maxAgeMs: POLICY_RATE_MAX_AGE_MS,
      };
    }

    // Reject unsupported assets explicitly. Note: the AssetCode union is
    // closed, so a caller passing 'BTC' is a runtime-only concern (e.g.,
    // dynamic input validation upstream). We still check defensively.
    if (!SUPPORTED_ASSETS.has(from)) {
      throw new CanonicalizationError({
        human_readable: `Cannot convert ${from} to ${to}: no rate source is configured for ${from} in phase 1. Asset is unsupported.`,
        user_action:
          `This asset requires a rate source to be added in a future phase. ` +
          `For now, author native-unit rules scoped to ${from} only, or ` +
          `remove this asset from the rule scope.`,
        details: {
          from_asset: from,
          to_asset: to,
          reason: 'unsupported_asset',
          supported_assets: Array.from(SUPPORTED_ASSETS),
        },
      });
    }

    // Fetch current prices from the oracle adapter
    let result: StablecoinPricesResult;
    try {
      result = await this.opts.fetchStablecoinPrices();
    } catch (err) {
      throw new CanonicalizationSourceUnavailableError({
        human_readable: `Rate provider (CoinGecko) is currently unavailable: ${extractMessage(err)}`,
        user_action:
          'Policy evaluation cannot proceed until the rate source returns. Retry in a few minutes or contact support if the issue persists.',
        details: {
          from_asset: from,
          to_asset: to,
          error_class: err instanceof Error ? err.name : typeof err,
          error_message: extractMessage(err),
        },
        cause: err,
      });
    }

    // Enforce source allowlist — opt-in, not mock-blacklist.
    if (!this.acceptedSources.has(result.source)) {
      throw new CanonicalizationSourceUnavailableError({
        human_readable:
          `Rate provider returned source="${result.source}", which is not in the accepted allowlist ` +
          `(${Array.from(this.acceptedSources).join(', ')}). Policy decisions require a trusted live rate source. ` +
          `If the oracle is in mock mode, this indicates COINGECKO_USE_MOCK=true in an environment where ` +
          `policy evaluation runs.`,
        user_action:
          'Check environment configuration — disable mock mode for production policy evaluation, or add the source to the provider allowlist if it is newly trusted.',
        details: {
          from_asset: from,
          to_asset: to,
          oracle_source: result.source,
          accepted_sources: Array.from(this.acceptedSources),
        },
      });
    }

    // Freshness check — guard both stale (too old) and negative-age (future-dated).
    const nowMs = Date.now();
    const fetchedAtMs = result.fetchedAt.getTime();
    const ageMs = nowMs - fetchedAtMs;

    if (ageMs < 0) {
      throw new CanonicalizationSourceUnavailableError({
        human_readable:
          `Rate provider returned a fetchedAt timestamp in the future (${result.fetchedAt.toISOString()}, ` +
          `${Math.abs(ageMs)}ms ahead of system clock). This indicates clock skew or a buggy oracle and cannot be trusted for policy evaluation.`,
        user_action:
          'Check the rate source host clock and the policy engine host clock — one of them is wrong. Rerun once clocks are aligned.',
        details: {
          from_asset: from,
          to_asset: to,
          source: result.source,
          rate_age_ms: ageMs,
          reason: 'fetched_at_in_future',
          fetched_at: result.fetchedAt.toISOString(),
          now: new Date(nowMs).toISOString(),
        },
      });
    }

    if (ageMs > POLICY_RATE_MAX_AGE_MS) {
      throw new CanonicalizationRateStaleError({
        human_readable:
          `Rate from ${result.source} for ${from}→${to} is ${ageMs}ms old, ` +
          `exceeding the maximum of ${POLICY_RATE_MAX_AGE_MS}ms allowed for policy decisions.`,
        user_action:
          'The rate provider may be stuck or cached. Check oracle health and retry once a fresh rate is available.',
        details: {
          from_asset: from,
          to_asset: to,
          source: result.source,
          rate_age_ms: ageMs,
          max_age_ms: POLICY_RATE_MAX_AGE_MS,
        },
      });
    }

    // Extract the specific rate
    const rateNumber = result.prices[from];
    if (rateNumber == null || !Number.isFinite(rateNumber)) {
      throw new CanonicalizationError({
        human_readable: `Rate provider returned no rate for ${from}.`,
        user_action: 'The rate source may be partially degraded. Contact support.',
        details: {
          from_asset: from,
          to_asset: to,
          source: result.source,
          received_prices: Object.keys(result.prices),
          received_value: rateNumber === undefined ? 'undefined' : String(rateNumber),
        },
      });
    }

    // Validate the stringified rate through the shared decimal primitive —
    // catches scientific notation from very small/large numbers, NaN, and
    // negative values (a buggy oracle returning -1 must not pass).
    const rateString = String(rateNumber);
    const parsed = decimalStringNonNegative.safeParse(rateString);
    if (!parsed.success) {
      throw new CanonicalizationError({
        human_readable:
          `Rate provider returned a rate for ${from} that cannot be represented as a non-negative decimal string ("${rateString}").`,
        user_action:
          'The rate source is returning an unparseable value. Contact support — policy decisions cannot proceed.',
        details: {
          from_asset: from,
          to_asset: to,
          source: result.source,
          rate_raw: rateNumber,
          rate_string: rateString,
          validation_error: parsed.error.issues[0]?.message ?? 'unknown',
        },
      });
    }

    return {
      rate: rateString,
      source: result.source,
      asOfRate: result.fetchedAt,
      maxAgeMs: POLICY_RATE_MAX_AGE_MS,
    };
  }
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
