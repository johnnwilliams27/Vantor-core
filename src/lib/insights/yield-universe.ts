/**
 * Yield Universe Service.
 *
 * Given a risk profile and customer context, produces the filtered list
 * of eligible venues the Yield Rebalance and Concentration detectors can
 * act on. Reads from the existing `src/lib/yield/venues/` registry
 * (static metadata) plus `yield_rate_cache` (live APY + TVL).
 *
 * Design decisions (see plan file):
 *   - Filters are applied in order: KYC → chain → asset → profile-specific
 *     vault requirements → yield-aware allocation bands → concentration caps.
 *   - Kamino Multiply is always included for display but flagged as
 *     non-actionable (derived yield is unreliable for agentic decisions).
 *   - Source-quality tier is attached per venue so detectors can downgrade
 *     or skip stale inputs.
 *   - TVL lives in `yield_rate_cache.tvl_usd`, NOT in the venue registry.
 *     This service joins them at query time.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  VENUES,
  isDeFiVault,
  isDeFiLendingMarket,
  isTokenizedMMF,
  type VenueMetadata,
  type VenueCategory,
  type DeFiVaultMetadata,
  type TokenizedMMFMetadata,
} from '@/lib/yield/venues';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { ChainType, TokenSymbol } from '@/types/database';
import {
  getProfile,
  resolveAllocationBands,
  isCustomerEligibleForKycTier,
  type RiskProfile,
} from './risk-profiles';
import type {
  AllocationBands,
} from './risk-profiles';
import type {
  AumTier,
  CustomerKycTier,
  DataFreshness,
  RiskProfileId,
} from './types';

// ─── Source quality tiers ────────────────────────────────────────────

/**
 * Data source quality tier per spec:
 *   1 = on-chain (Aave V3, Compound V3) — authoritative
 *   2 = protocol API (Morpho, Kamino Lend) — usually accurate, subject to provider downtime
 *   3 = derived (Kamino Multiply) — use with caution, no actionable rebalance
 *   4 = reference (MMF seed values) — informational only, never actionable
 */
export type ApyTier = 1 | 2 | 3 | 4;

const PROTOCOL_TIER: Record<string, ApyTier> = {
  aave_v3: 1,
  compound_v3: 1,
  kamino: 2,
  morpho_steakhouse: 2,
  morpho_reservoir: 2,
  kamino_multiply: 3, // derived — never actionable
  ondo_usdy: 2,       // on-chain oracle but via protocol API wrapper
  sky: 1,             // on-chain Sky Savings Rate
  ethena: 2,          // REST API
};

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ─── Query types ─────────────────────────────────────────────────────

export interface YieldUniverseQuery {
  riskProfileId: RiskProfileId;
  aumTier: AumTier;
  asset: TokenSymbol;
  /** Optional — restrict to one chain. Default: both. */
  chain?: ChainType;
  /** Customer KYC tier. Null treated as retail. */
  customerKycTier?: CustomerKycTier;
}

export interface EligibleVenue {
  venue: VenueMetadata;
  /** Current APY as a decimal (e.g. 0.0485 = 4.85%). Null if no cache entry. */
  currentApy: number | null;
  /** Data source quality tier. */
  apyTier: ApyTier;
  /** Per spec: if >10 min old, downgrade severity or skip. */
  isStale: boolean;
  /** Data freshness bucket for insight metadata. */
  dataFreshness: DataFreshness;
  /** Age of the rate in seconds (null if never fetched). */
  ageSeconds: number | null;
  /** TVL in USD — only populated for DeFi vaults + lending markets. */
  tvlUsd: number | null;
  /** Fund size in USD — only populated for tokenized MMFs. */
  fundSizeUsd: number | null;
  /** Profile-specific concentration cap for THIS venue at THIS profile. */
  concentrationCapUsd: number | null;
  /** Human-readable reason for the concentration cap (for rationale display). */
  concentrationCapReason: string | null;
  /** If non-actionable, the reason. Detectors MUST honor this. */
  nonActionableReason: string | null;
}

export interface DisqualifiedVenue {
  venue: VenueMetadata;
  reasons: string[];
}

export interface YieldUniverseView {
  profile: RiskProfile;
  bands: AllocationBands;
  eligible: EligibleVenue[];
  disqualified: DisqualifiedVenue[];
  /**
   * Best primary APY across eligible tokenized MMFs, as a decimal.
   * Null if no eligible MMFs.
   */
  bestPrimaryApy: number | null;
  /**
   * Best satellite APY across eligible DeFi venues, as a decimal.
   * Null if no eligible satellite venues.
   */
  bestSatelliteApy: number | null;
  /**
   * Effective satellite eligibility based on yield-aware bands.
   * If satellite premium over primary is below the profile threshold,
   * detectors treat satellites as informational-only for Conservative.
   */
  satelliteAllocationActive: boolean;
}

// ─── Yield rate cache row ────────────────────────────────────────────

interface YieldRateCacheRow {
  protocol: string;
  token: string;
  chain: string;
  supply_apy: string | number;
  reward_apy: string | number;
  total_apy: string | number;
  tvl_usd: string | number | null;
  fetched_at: string;
  is_stale: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function computeFreshness(ageMs: number, isStale: boolean): {
  freshness: DataFreshness;
  isStale: boolean;
} {
  if (isStale) {
    return { freshness: 'stale_over_10min', isStale: true };
  }
  if (ageMs > STALE_THRESHOLD_MS) {
    return { freshness: 'stale_over_10min', isStale: true };
  }
  if (ageMs > STALE_THRESHOLD_MS / 2) {
    return { freshness: 'stale_under_10min', isStale: false };
  }
  return { freshness: 'fresh', isStale: false };
}

function monthsSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  const now = Date.now();
  const monthsMs = 30.44 * 24 * 60 * 60 * 1000;
  return (now - then) / monthsMs;
}

function computeConcentrationCap(
  venue: VenueMetadata,
  profile: RiskProfile,
  tvlUsd: number | null,
): { capUsd: number | null; reason: string | null } {
  if (isTokenizedMMF(venue)) {
    // Primary (MMF) cap is per-issuer, applied at portfolio level by the
    // Concentration detector, not per-venue here.
    return { capUsd: null, reason: 'Per-issuer cap applied at portfolio level' };
  }

  if (isDeFiVault(venue) || isDeFiLendingMarket(venue)) {
    if (tvlUsd == null) {
      return {
        capUsd: null,
        reason: 'TVL unknown — cannot compute concentration cap',
      };
    }

    const percentCap = tvlUsd * profile.concentration.satellitePerVaultMaxVaultSharePct;
    const absCap = profile.concentration.satellitePerVaultMaxAbsUsd;
    const effectiveCap = Math.min(percentCap, absCap);
    const pctLabel = `${(profile.concentration.satellitePerVaultMaxVaultSharePct * 100).toFixed(1)}%`;
    const absLabel = `$${(absCap / 1_000_000).toFixed(0)}M`;

    const reason =
      percentCap < absCap
        ? `${pctLabel} of vault TVL ($${(percentCap / 1_000_000).toFixed(1)}M)`
        : `Absolute cap (${absLabel})`;

    return { capUsd: effectiveCap, reason };
  }

  return { capUsd: null, reason: null };
}

// ─── Core filter pipeline ────────────────────────────────────────────

interface FilterResult {
  passes: boolean;
  reasons: string[];
}

function filterKyc(
  venue: VenueMetadata,
  customerKyc: CustomerKycTier | undefined,
): FilterResult {
  const reasons: string[] = [];

  if (isTokenizedMMF(venue)) {
    if (!isCustomerEligibleForKycTier(customerKyc, venue.eligibility)) {
      reasons.push(
        `Customer KYC tier (${customerKyc ?? 'none'}) does not meet venue requirement (${venue.eligibility})`,
      );
    }
  } else if (venue.kycRequired && !customerKyc) {
    reasons.push('Venue requires KYC but customer has none');
  }

  return { passes: reasons.length === 0, reasons };
}

function filterChain(
  venue: VenueMetadata,
  chain: ChainType | undefined,
): FilterResult {
  if (!chain) return { passes: true, reasons: [] };
  if (venue.chain === chain) return { passes: true, reasons: [] };
  return {
    passes: false,
    reasons: [`Venue is on ${venue.chain}, query requested ${chain}`],
  };
}

function filterAsset(venue: VenueMetadata, asset: TokenSymbol): FilterResult {
  if (venue.supportedTokens.includes(asset)) return { passes: true, reasons: [] };
  return {
    passes: false,
    reasons: [`Venue does not support ${asset}`],
  };
}

function filterStatus(venue: VenueMetadata): FilterResult {
  if (venue.status === 'live') return { passes: true, reasons: [] };
  return {
    passes: false,
    reasons: [`Venue status is ${venue.status}`],
  };
}

function filterVaultRequirements(
  venue: VenueMetadata,
  profile: RiskProfile,
  tvlUsd: number | null,
): FilterResult {
  const reasons: string[] = [];

  if (isDeFiVault(venue) || isDeFiLendingMarket(venue)) {
    const req = profile.satelliteRequirements;

    if (venue.monthsLive != null && venue.monthsLive < req.minMonthsLive) {
      reasons.push(
        `Only ${venue.monthsLive}mo live, profile requires ${req.minMonthsLive}mo+`,
      );
    }

    if (tvlUsd != null && tvlUsd < req.minTvlUsd) {
      reasons.push(
        `TVL $${(tvlUsd / 1_000_000).toFixed(1)}M below profile minimum $${(req.minTvlUsd / 1_000_000).toFixed(0)}M`,
      );
    }

    if (isDeFiVault(venue) && venue.lastIncidentDate) {
      const monthsAgo = monthsSince(venue.lastIncidentDate);
      if (monthsAgo != null && monthsAgo < req.incidentDisqualifierMonths) {
        reasons.push(
          `Incident ${monthsAgo.toFixed(1)}mo ago, within ${req.incidentDisqualifierMonths}mo disqualifier window`,
        );
      }
    }
  }

  return { passes: reasons.length === 0, reasons };
}

function filterCurator(venue: VenueMetadata, profile: RiskProfile): FilterResult {
  if (!isDeFiVault(venue)) return { passes: true, reasons: [] };

  // Empty set = open universe (Growth profile)
  if (profile.allowedSatelliteCurators.size > 0 &&
      !profile.allowedSatelliteCurators.has(venue.curator)) {
    return {
      passes: false,
      reasons: [`Curator '${venue.curator}' not in profile's allowlist`],
    };
  }

  return { passes: true, reasons: [] };
}

// ─── Main entry point ────────────────────────────────────────────────

export async function buildYieldUniverse(
  query: YieldUniverseQuery,
  supabase: SupabaseClient = createAdminClient(),
): Promise<YieldUniverseView> {
  const profile = getProfile(query.riskProfileId);
  const bands = resolveAllocationBands(profile, query.aumTier);

  // Fetch all yield rate cache rows in one query. We'll filter by asset/chain
  // per venue in memory — the cache is small (~15-25 rows total).
  const { data: rates, error } = await supabase
    .from('yield_rate_cache')
    .select('protocol, token, chain, supply_apy, reward_apy, total_apy, tvl_usd, fetched_at, is_stale')
    .eq('token', query.asset);

  if (error) {
    throw new Error(`Failed to fetch yield rate cache: ${error.message}`);
  }

  const rateMap = new Map<string, YieldRateCacheRow>();
  for (const row of (rates ?? []) as YieldRateCacheRow[]) {
    const key = `${row.protocol}:${row.token}:${row.chain}`;
    rateMap.set(key, row);
  }

  const eligible: EligibleVenue[] = [];
  const disqualified: DisqualifiedVenue[] = [];

  for (const venueId of Object.keys(VENUES) as YieldProtocolId[]) {
    const venue = VENUES[venueId];

    // Run filters in order. Collect ALL reasons for disqualification
    // (not just the first) so the UI can show a complete picture.
    const filters: FilterResult[] = [
      filterStatus(venue),
      filterKyc(venue, query.customerKycTier),
      filterChain(venue, query.chain),
      filterAsset(venue, query.asset),
      filterCurator(venue, profile),
    ];

    const allReasons = filters.flatMap((f) => f.reasons);
    const baseDisqualified = !filters.every((f) => f.passes);

    // Look up the rate from cache. Rate lookup key is (protocol, token, chain).
    const rateKey = `${venue.id}:${query.asset}:${venue.chain}`;
    const rateRow = rateMap.get(rateKey);

    const currentApy = rateRow ? Number(rateRow.total_apy) : null;
    const tvlUsd = rateRow?.tvl_usd != null ? Number(rateRow.tvl_usd) : null;
    const fundSizeUsd = isTokenizedMMF(venue) ? venue.fundSizeUsd : null;

    // Compute freshness
    let ageSeconds: number | null = null;
    let freshness: DataFreshness = 'fresh';
    let isStale = false;
    if (rateRow) {
      const ageMs = Date.now() - new Date(rateRow.fetched_at).getTime();
      ageSeconds = Math.floor(ageMs / 1000);
      const result = computeFreshness(ageMs, rateRow.is_stale);
      freshness = result.freshness;
      isStale = result.isStale;
    }

    // Apply vault requirements filter (needs TVL)
    const vaultFilter = filterVaultRequirements(venue, profile, tvlUsd);
    allReasons.push(...vaultFilter.reasons);
    const fullDisqualified = baseDisqualified || !vaultFilter.passes;

    if (fullDisqualified) {
      disqualified.push({ venue, reasons: allReasons });
      continue;
    }

    // Compute concentration cap
    const { capUsd, reason: capReason } = computeConcentrationCap(
      venue,
      profile,
      tvlUsd,
    );

    // Determine non-actionable status for Kamino Multiply (tier 3)
    const apyTier: ApyTier = isTokenizedMMF(venue)
      ? 4 // reference values — never actionable for rebalance
      : (PROTOCOL_TIER[venue.id] ?? 2);

    let nonActionableReason: string | null = null;
    if (apyTier === 3) {
      nonActionableReason =
        'Derived yield (supply × leverage constant) is not a reliable actionable input';
    } else if (apyTier === 4) {
      nonActionableReason =
        'Reference yield for coming_soon MMF — informational only, not a live quote';
    }

    eligible.push({
      venue,
      currentApy,
      apyTier,
      isStale,
      dataFreshness: freshness,
      ageSeconds,
      tvlUsd,
      fundSizeUsd,
      concentrationCapUsd: capUsd,
      concentrationCapReason: capReason,
      nonActionableReason,
    });
  }

  // Compute best primary/satellite APYs from ACTIONABLE tiers only (1 or 2).
  // Kamino Multiply (tier 3) and reference MMFs (tier 4) are excluded.
  const actionableEligible = eligible.filter((e) => e.apyTier <= 2 && e.currentApy != null);

  const primaryCandidates = actionableEligible.filter(
    (e) => isTokenizedMMF(e.venue),
  );
  const satelliteCandidates = actionableEligible.filter(
    (e) => !isTokenizedMMF(e.venue),
  );

  const bestPrimaryApy = primaryCandidates.length > 0
    ? Math.max(...primaryCandidates.map((e) => e.currentApy as number))
    : null;

  const bestSatelliteApy = satelliteCandidates.length > 0
    ? Math.max(...satelliteCandidates.map((e) => e.currentApy as number))
    : null;

  // Yield-aware satellite allocation gate for Conservative/Balanced
  let satelliteAllocationActive = bands.defaultSatellitePct > 0;
  if (profile.id === 'conservative' && bestPrimaryApy != null && bestSatelliteApy != null) {
    const gapBps = (bestSatelliteApy - bestPrimaryApy) * 10_000;
    satelliteAllocationActive = gapBps >= profile.bands.satelliteYieldPremiumBps;
  }

  return {
    profile,
    bands,
    eligible,
    disqualified,
    bestPrimaryApy,
    bestSatelliteApy,
    satelliteAllocationActive,
  };
}

// ─── Convenience exports for detectors ───────────────────────────────

/**
 * Convenience: get only the category breakdown without the full view.
 * Used by the Concentration detector when it needs to compute category-
 * level totals without running filter logic.
 */
export function groupByCategory(
  view: YieldUniverseView,
): Record<VenueCategory, EligibleVenue[]> {
  const groups: Record<VenueCategory, EligibleVenue[]> = {
    tokenized_mmf: [],
    defi_vault: [],
    defi_lending_market: [],
  };
  for (const v of view.eligible) {
    groups[v.venue.category].push(v);
  }
  return groups;
}
