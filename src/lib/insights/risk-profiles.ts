/**
 * Risk profile definitions for the Treasury Insights Engine.
 *
 * Each profile defines the eligible yield universe and concentration
 * limits for a customer. Allocation between primary venues (tokenized
 * MMFs) and satellite venues (DeFi vaults + lending markets) is
 * **dynamic and yield-aware**, not a fixed percentage — the engine
 * reads the live yield gap between best primary and best satellite
 * and adjusts within the profile's bounds.
 *
 * Profiles are static TypeScript. A future PR may add treasurer
 * customization, but v1 ships with three hand-tuned presets.
 *
 * Per-tier overrides apply on top of the base profile to account for
 * AUM scaling — an Enterprise customer with $250M can't allocate 30%
 * to a satellite DeFi vault because they'd saturate the vault's
 * capacity. The override math is applied in `resolveProfile()`.
 *
 * See plan file for the full profile spec and worked examples.
 */

import type { RiskProfileId, AumTier, CustomerKycTier } from './types';

// ─── Satellite eligibility requirements ──────────────────────────────

export interface SatelliteVaultRequirements {
  /** Minimum months the vault has been live for it to be considered. */
  minMonthsLive: number;
  /** Minimum TVL in USD. Below this, the vault is excluded. */
  minTvlUsd: number;
  /** Disqualifier window in months — vaults with incidents this recent are out. */
  incidentDisqualifierMonths: number;
  /** Maximum utilization rate (0-1) before liquidity risk flag. */
  maxUtilizationRate: number;
  /** Maximum acceptable exit slippage as a decimal (0.005 = 50bps). */
  maxExitSlippage: number;
}

// ─── Concentration limits ────────────────────────────────────────────

export interface ConcentrationLimits {
  /**
   * Per-issuer cap on primary (tokenized MMF) allocation, as a decimal.
   * E.g. 0.50 = 50%. Forces diversification across multiple MMF issuers.
   */
  primaryPerIssuerMaxPct: number;

  /**
   * Per-vault concentration on satellite, as { maxVaultSharePct, maxAbsUsd }.
   * The customer's position in any one vault must not exceed either limit.
   * Effective cap is min(vaultTvl * maxVaultSharePct, maxAbsUsd).
   */
  satellitePerVaultMaxVaultSharePct: number;
  satellitePerVaultMaxAbsUsd: number;

  /**
   * Per-curator satellite cap as a decimal. v1 only enforces this for
   * Growth (Conservative and Balanced naturally stay under it given their
   * curator whitelist is short).
   */
  satellitePerCuratorMaxPct?: number;

  /** Per-chain concentration cap as a decimal of total yield AUM. */
  perChainMaxPct: number;

  /** Warning threshold — fires `concentration_warning` at this % of cap. */
  warningThresholdPct: number;
}

// ─── Allocation bands (yield-aware) ──────────────────────────────────

export interface AllocationBands {
  /**
   * Default primary allocation (tokenized MMFs) as a decimal.
   * E.g. 1.00 = 100% primary, 0 satellite.
   */
  defaultPrimaryPct: number;
  /** Default satellite allocation. Must sum to 1.0 with defaultPrimaryPct. */
  defaultSatellitePct: number;
  /**
   * Minimum satellite yield premium over primary (in bps) required to
   * make satellite allocation attractive. Below this, the engine defaults
   * to max primary.
   */
  satelliteYieldPremiumBps: number;
  /**
   * Primary allocation when satellite premium is high enough to justify
   * rebalancing. E.g. Balanced drops from 0.70 to 0.50 when satellites
   * exceed primary by 100bps+.
   */
  highPremiumPrimaryPct: number;
  highPremiumSatellitePct: number;
}

// ─── Full risk profile ───────────────────────────────────────────────

export interface RiskProfile {
  id: RiskProfileId;
  displayName: string;
  description: string;

  /** Multiplier applied to the obligation lookahead window for the safety buffer. */
  safetyBufferMultiplier: number;

  /** Allocation bands (primary vs satellite). */
  bands: AllocationBands;

  /** Minimum vault requirements for satellite inclusion. */
  satelliteRequirements: SatelliteVaultRequirements;

  /** Concentration limits across multiple axes. */
  concentration: ConcentrationLimits;

  /**
   * Approved satellite curators. Empty set means "no curator whitelist"
   * (open to all). Used by the yield universe service to filter vaults.
   */
  allowedSatelliteCurators: Set<string>;

  /**
   * Contagion-exposure disqualifiers. Vaults from curators on this list
   * are blocked if they had exposure to the named incident within the
   * profile's disqualifier window.
   */
  curatorContagionBlacklist: Set<string>;

  /** Allowed stablecoins for satellite deposits. */
  allowedSatelliteStablecoins: Set<string>;
}

// ─── The three preset profiles ───────────────────────────────────────

export const CONSERVATIVE_PROFILE: RiskProfile = {
  id: 'conservative',
  displayName: 'Conservative',
  description:
    'Primary allocation to tokenized MMFs only by default. Satellite DeFi becomes eligible only when yield premium exceeds 50bps. Strict per-vault concentration caps.',
  safetyBufferMultiplier: 1.5,
  bands: {
    defaultPrimaryPct: 1.0,
    defaultSatellitePct: 0.0,
    satelliteYieldPremiumBps: 50,
    highPremiumPrimaryPct: 0.8,
    highPremiumSatellitePct: 0.2,
  },
  satelliteRequirements: {
    minMonthsLive: 12,
    minTvlUsd: 200_000_000, // $200M
    incidentDisqualifierMonths: 12,
    maxUtilizationRate: 0.95,
    maxExitSlippage: 0.005, // 50bps
  },
  concentration: {
    primaryPerIssuerMaxPct: 0.50,
    satellitePerVaultMaxVaultSharePct: 0.05, // 5% of vault TVL
    satellitePerVaultMaxAbsUsd: 10_000_000,  // $10M
    perChainMaxPct: 0.75, // most primary lives on Ethereum
    warningThresholdPct: 0.80,
  },
  allowedSatelliteCurators: new Set(['Steakhouse Financial', 'Gauntlet']),
  curatorContagionBlacklist: new Set(['Stream Finance', 'Resolv']),
  allowedSatelliteStablecoins: new Set(['USDC', 'USDT']),
};

export const BALANCED_PROFILE: RiskProfile = {
  id: 'balanced',
  displayName: 'Balanced',
  description:
    '70% primary / 30% satellite at parity, shifting to 50/50 when satellite offers a 100bps+ premium. Broader curator whitelist with contagion screening.',
  safetyBufferMultiplier: 1.25,
  bands: {
    defaultPrimaryPct: 0.70,
    defaultSatellitePct: 0.30,
    satelliteYieldPremiumBps: 100,
    highPremiumPrimaryPct: 0.50,
    highPremiumSatellitePct: 0.50,
  },
  satelliteRequirements: {
    minMonthsLive: 6,
    minTvlUsd: 100_000_000, // $100M
    incidentDisqualifierMonths: 6,
    maxUtilizationRate: 0.95,
    maxExitSlippage: 0.01, // 100bps
  },
  concentration: {
    primaryPerIssuerMaxPct: 0.50,
    satellitePerVaultMaxVaultSharePct: 0.075, // 7.5%
    satellitePerVaultMaxAbsUsd: 15_000_000,   // $15M
    perChainMaxPct: 0.75,
    warningThresholdPct: 0.80,
  },
  allowedSatelliteCurators: new Set([
    'Steakhouse Financial',
    'Gauntlet',
    'Re7',
    'MEV Capital',
  ]),
  curatorContagionBlacklist: new Set(['Stream Finance', 'Resolv']),
  allowedSatelliteStablecoins: new Set(['USDC', 'USDT', 'sUSDe', 'sDAI']),
};

export const GROWTH_PROFILE: RiskProfile = {
  id: 'growth',
  displayName: 'Growth',
  description:
    '30% primary / 70% satellite when satellite yields justify. Full curator universe with explicit per-curator opt-in for contagion-exposed curators.',
  safetyBufferMultiplier: 1.0,
  bands: {
    defaultPrimaryPct: 0.30,
    defaultSatellitePct: 0.70,
    satelliteYieldPremiumBps: 0, // no premium required — growth accepts parity
    highPremiumPrimaryPct: 0.20,
    highPremiumSatellitePct: 0.80,
  },
  satelliteRequirements: {
    minMonthsLive: 3,
    minTvlUsd: 50_000_000, // $50M
    incidentDisqualifierMonths: 3,
    maxUtilizationRate: 0.95,
    maxExitSlippage: 0.02, // 200bps
  },
  concentration: {
    primaryPerIssuerMaxPct: 0.60,
    satellitePerVaultMaxVaultSharePct: 0.10, // 10%
    satellitePerVaultMaxAbsUsd: 20_000_000,  // $20M
    satellitePerCuratorMaxPct: 0.40,
    perChainMaxPct: 0.80,
    warningThresholdPct: 0.80,
  },
  allowedSatelliteCurators: new Set(), // empty = open universe
  curatorContagionBlacklist: new Set(), // contagion exposure requires per-curator opt-in, not blanket block
  allowedSatelliteStablecoins: new Set(['USDC', 'USDT', 'sUSDe', 'sDAI']),
};

export const ALL_PROFILES: Record<RiskProfileId, RiskProfile> = {
  conservative: CONSERVATIVE_PROFILE,
  balanced: BALANCED_PROFILE,
  growth: GROWTH_PROFILE,
};

// ─── Per-tier overrides ──────────────────────────────────────────────

/**
 * Returns the effective allocation bands for a customer given their
 * base profile and AUM tier. Enterprise customers in Conservative stay
 * at 100% primary regardless of yield gap because $250M+ at any
 * meaningful satellite percentage would saturate DeFi capacity.
 */
export function resolveAllocationBands(
  profile: RiskProfile,
  aumTier: AumTier,
): AllocationBands {
  const base = profile.bands;

  if (profile.id === 'conservative' && aumTier === 'enterprise') {
    // Enterprise conservative: forced 100% primary, no satellite allocation
    // regardless of yield gap — satellite capacity can't absorb $250M+.
    return {
      ...base,
      defaultPrimaryPct: 1.0,
      defaultSatellitePct: 0.0,
      highPremiumPrimaryPct: 1.0,
      highPremiumSatellitePct: 0.0,
    };
  }

  if (profile.id === 'balanced') {
    if (aumTier === 'scale') {
      // Scale Balanced: prefer 70/30 stability over shifting to 50/50 at premium
      return {
        ...base,
        defaultPrimaryPct: 0.70,
        defaultSatellitePct: 0.30,
        highPremiumPrimaryPct: 0.70,
        highPremiumSatellitePct: 0.30,
      };
    }
    if (aumTier === 'enterprise') {
      // Enterprise Balanced: 80/20 — satellite capacity too limited above $70M AUM
      return {
        ...base,
        defaultPrimaryPct: 0.80,
        defaultSatellitePct: 0.20,
        highPremiumPrimaryPct: 0.80,
        highPremiumSatellitePct: 0.20,
      };
    }
  }

  if (profile.id === 'growth') {
    if (aumTier === 'scale') {
      // Scale Growth: 50/50 instead of 30/70
      return {
        ...base,
        defaultPrimaryPct: 0.50,
        defaultSatellitePct: 0.50,
        highPremiumPrimaryPct: 0.50,
        highPremiumSatellitePct: 0.50,
      };
    }
    if (aumTier === 'enterprise') {
      // Enterprise Growth: 60/40 in favor of primary
      return {
        ...base,
        defaultPrimaryPct: 0.60,
        defaultSatellitePct: 0.40,
        highPremiumPrimaryPct: 0.60,
        highPremiumSatellitePct: 0.40,
      };
    }
  }

  return base;
}

/**
 * Get a profile by ID. Throws if unknown — callers should validate first.
 */
export function getProfile(id: RiskProfileId): RiskProfile {
  const profile = ALL_PROFILES[id];
  if (!profile) {
    throw new Error(`Unknown risk profile: ${id}`);
  }
  return profile;
}

/**
 * Convenience check: is this customer eligible for a venue given their KYC tier?
 * QP-gated funds only appear for qualified_purchaser customers.
 */
export function isCustomerEligibleForKycTier(
  customerTier: CustomerKycTier | undefined,
  venueEligibility: string,
): boolean {
  if (venueEligibility === 'none') return true;
  if (!customerTier) return false; // venue requires KYC, customer has none

  if (venueEligibility === 'accredited_investor') {
    return customerTier === 'accredited' || customerTier === 'qualified_purchaser';
  }
  if (venueEligibility === 'qualified_purchaser') {
    return customerTier === 'qualified_purchaser';
  }
  if (venueEligibility === 'non_us_only') {
    // v1 doesn't model US vs non-US status; assume ineligible for safety
    return false;
  }

  return false;
}
