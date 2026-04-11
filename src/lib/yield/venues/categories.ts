/**
 * Venue category system.
 *
 * A "venue" is anywhere we route stablecoin yield to: a DeFi lending market,
 * a curated DeFi vault, or a tokenized money market fund. Each category has
 * materially different semantics — capacity model, risk model, redemption
 * mechanics, regulatory wrapper — so we model them as a discriminated union
 * instead of a flat Record with many optional fields.
 *
 * The "categories, not strings" principle (see spec):
 *   - Category is a first-class union tag, narrowable by TS.
 *   - Category drives which metadata fields are required/available.
 *   - "TVL" is reserved for DeFi venues; tokenized MMFs use "Fund Size".
 *     Different field names so a future bug can't accidentally compare a
 *     $2B BUIDL fund to a $2B Aave pool as if they had the same capacity
 *     constraint — they don't.
 *
 * The category system is TypeScript-only. Venue metadata lives in
 * `venues-registry.ts` as a static record. We considered polymorphic
 * per-category tables in Postgres but rejected it: venues are a fixed,
 * hand-curated set, they change about monthly, and there's no per-row
 * mutation pattern that would benefit from a DB-backed venue table.
 * Type safety in TypeScript is enforced via the discriminated union.
 */

import type { ChainType, TokenSymbol } from '@/types/database';
import type {
  YieldProtocolId,
  YieldRiskLevel,
  RiskFactors,
} from '@/lib/yield/interface';

// ─── Category and status enums ──────────────────────────────────────

export type VenueCategory =
  | 'tokenized_mmf'
  | 'defi_vault'
  | 'defi_lending_market';

export type VenueStatus = 'live' | 'coming_soon' | 'deprecated';

// ─── Tokenized MMF subtypes ─────────────────────────────────────────

/**
 * Investor eligibility tier — a compliance classification, not a risk rating.
 * Display-only in this PR; future PRs will gate deposit flows on it.
 */
export type EligibilityTier =
  | 'none'                  // Open to all eligible customers (passes KYC)
  | 'accredited_investor'   // US accredited investor self-attestation
  | 'qualified_purchaser'   // US QP: $5M+ investable assets (Reg D 506(c))
  | 'non_us_only';          // Not offered to US persons

/**
 * How fast a redemption settles to USDC or fiat. Materially different
 * across products — instant_24_7 (Ondo OUSG) vs t_plus_1_daily_nav
 * (Franklin BENJI) vs weekly_subscription (smaller non-US funds).
 */
export type RedemptionMechanics =
  | 'instant_24_7'          // Mint/redeem at any hour, settles in seconds
  | 't_plus_0'              // Same-business-day redemption
  | 't_plus_1_daily_nav'    // Settles at next daily NAV cut
  | 'weekly_subscription'   // Weekly subscription/redemption window
  | 'other';

// ─── Common fields shared across all venue categories ──────────────

export interface VenueMetadataBase {
  /** Protocol ID — must match the `yield_protocol_id` enum in Postgres. */
  id: YieldProtocolId;
  /** Human-readable display name shown on cards. */
  displayName: string;
  /** Short one-paragraph description. Shown below the title on the card. */
  description: string;
  /** Primary chain the product lives on. */
  chain: ChainType;
  /** Underlying stablecoins accepted for deposit. */
  supportedTokens: TokenSymbol[];
  /** Live / coming_soon / deprecated. Drives badge + deposit gating. */
  status: VenueStatus;
  /** Overall risk tier (low/medium/high) — cosmetic header badge. */
  riskLevel: YieldRiskLevel;
  /** Structured risk factors — drives the risk meter on each card. */
  riskFactors: RiskFactors;
  /** True if deposit requires off-platform KYC (e.g. Ondo legacy). */
  kycRequired: boolean;
}

// ─── DeFi Vault (curated, non-permissionless) ──────────────────────

export interface DeFiVaultMetadata extends VenueMetadataBase {
  category: 'defi_vault';
  /** Name of the curator who manages the vault's allocations (e.g. 'Steakhouse Financial'). */
  curator: string;
  /** Underlying protocol the vault is built on ('Morpho Blue', 'Kamino', etc.). */
  underlyingProtocol: string;
  /** Primary vault contract address (nullable while vault is still coming_soon). */
  vaultAddress: string | null;
  /** How many months the vault has been live — a proxy for battle-testedness. */
  monthsLive: number | null;
  /** Date of the last security incident, null if clean. ISO date string. */
  lastIncidentDate: string | null;
}

// ─── DeFi Lending Market (permissionless pool) ─────────────────────

export interface DeFiLendingMarketMetadata extends VenueMetadataBase {
  category: 'defi_lending_market';
  /** Underlying protocol ('Aave', 'Compound V3', 'Kamino'). */
  underlyingProtocol: string;
  /** Pool/reserve address on the primary chain. */
  marketAddress: string | null;
  /** How many months the market has been live. */
  monthsLive: number | null;
}

// ─── Tokenized Money Market Fund ───────────────────────────────────

export interface TokenizedMMFMetadata extends VenueMetadataBase {
  category: 'tokenized_mmf';
  /** The issuing entity (BlackRock, Ondo Finance, Circle, Spiko, etc.). */
  issuer: string;
  /**
   * The fund manager. May differ from the issuer.
   * E.g. Superstate USTB is issued by Superstate but managed by Invesco
   * as of Q2 2026.
   */
  fundManager: string;
  /**
   * Current AUM / fund size in USD. Deliberately called `fundSizeUsd` not
   * `tvl` — tokenized MMFs are backed by underlying Treasury markets with
   * effectively unlimited capacity, so the term "TVL" (implying a capacity
   * constraint like a DeFi pool) is misleading. UI must label this as
   * "Fund Size" or "AUM", never "TVL".
   */
  fundSizeUsd: number | null;
  /**
   * Short description of what the fund holds on its balance sheet.
   * E.g. "Short-term US Treasuries, repo, cash."
   */
  underlyingComposition: string;
  /**
   * Regulatory wrapper. Free text but standard values include:
   * "SEC-registered (1940 Act)", "Reg D 506(c)", "EU UCITS",
   * "Cayman feeder fund". Shown as a trust signal on the card.
   */
  regulatoryWrapper: string;
  /** Investor eligibility tier — drives badge + future gating. */
  eligibility: EligibilityTier;
  /**
   * Reference yield at the `yieldAsOf` date, as a decimal.
   * E.g. 0.0347 = 3.47%. For coming_soon MMFs this is NOT a live quote —
   * it's a recent snapshot from rwa.xyz or the issuer dashboard, captured
   * at migration time. Shown with the as-of date so users don't mistake
   * it for a live rate.
   */
  referenceYield: number;
  /** ISO date the `referenceYield` was captured. Rendered as "as of ..." */
  yieldAsOf: string;
  /** Reporting currency for the fund shares. Usually USD, EUR for Spiko EUR. */
  currency: 'USD' | 'EUR';
  /** Chains where the tokenized shares are issued/redeemable. */
  supportedChains: string[];
  /** Redemption speed class. Drives the "time to cash" badge. */
  redemptionMechanics: RedemptionMechanics;
  /**
   * Human-readable time to cash estimate — used as the label on the card
   * next to the redemption icon. E.g. "24/7 instant", "T+1 daily NAV".
   */
  timeToCash: string;
  /** How often the fund reports NAV / attestation ("Daily NAV", "Monthly"). */
  reportingCadence: string;
  /** Onboarding partner (Securitize, direct allowlist, etc.). */
  onboardingPartner: string;
  /** 1-2 sentence qualitative summary shown on the card. */
  notes: string;
}

// ─── The discriminated union ────────────────────────────────────────

export type VenueMetadata =
  | DeFiVaultMetadata
  | DeFiLendingMarketMetadata
  | TokenizedMMFMetadata;

// ─── Narrowing helpers ──────────────────────────────────────────────

export function isDeFiVault(v: VenueMetadata): v is DeFiVaultMetadata {
  return v.category === 'defi_vault';
}

export function isDeFiLendingMarket(v: VenueMetadata): v is DeFiLendingMarketMetadata {
  return v.category === 'defi_lending_market';
}

export function isTokenizedMMF(v: VenueMetadata): v is TokenizedMMFMetadata {
  return v.category === 'tokenized_mmf';
}

/**
 * Returns true if this venue's category represents a DeFi yield position.
 * Used by the holdings categorization function to route positions into
 * the DeFi Positions card vs the Cash card.
 */
export function isDeFiCategory(category: VenueCategory): boolean {
  return category === 'defi_vault' || category === 'defi_lending_market';
}

// ─── Display labels ─────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<VenueCategory, string> = {
  tokenized_mmf: 'Tokenized MMF',
  defi_vault: 'DeFi Vault',
  defi_lending_market: 'DeFi Lending Market',
};

export const STATUS_LABELS: Record<VenueStatus, string> = {
  live: 'Live',
  coming_soon: 'Coming Soon',
  deprecated: 'Deprecated',
};

export const ELIGIBILITY_LABELS: Record<EligibilityTier, string> = {
  none: 'Open',
  accredited_investor: 'Accredited Investor',
  qualified_purchaser: 'Qualified Purchaser',
  non_us_only: 'Non-US only',
};

export const REDEMPTION_LABELS: Record<RedemptionMechanics, string> = {
  instant_24_7: '24/7 instant',
  t_plus_0: 'T+0 same-day',
  t_plus_1_daily_nav: 'T+1 daily NAV',
  weekly_subscription: 'Weekly subscription',
  other: 'Other',
};
