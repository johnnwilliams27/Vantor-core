/**
 * Public barrel for the venue category system.
 *
 * Import from `@/lib/yield/venues` in app code — never reach into
 * `categories.ts` or `registry.ts` directly unless you have a reason.
 */

export type {
  VenueCategory,
  VenueStatus,
  VenueMetadata,
  VenueMetadataBase,
  DeFiVaultMetadata,
  DeFiLendingMarketMetadata,
  TokenizedMMFMetadata,
  EligibilityTier,
  RedemptionMechanics,
} from './categories';

export {
  isDeFiVault,
  isDeFiLendingMarket,
  isTokenizedMMF,
  isDeFiCategory,
  CATEGORY_LABELS,
  STATUS_LABELS,
  ELIGIBILITY_LABELS,
  REDEMPTION_LABELS,
} from './categories';

export {
  VENUES,
  ALL_VENUE_IDS,
  MMF_YIELDS_AS_OF,
  getVenue,
} from './registry';
