/**
 * Centralized display helpers for yield venues.
 *
 * Every UI component that shows a venue name, logo, or label should use
 * these helpers instead of maintaining its own local PROTOCOL_LABELS /
 * PROTOCOL_LOGOS record. Previously there were 8 copies of these maps
 * across the codebase, all slightly out of sync — adding a new venue
 * meant hunting them all down, and one of them would always get missed.
 * Now the venue registry is the single source of truth.
 */

import type { YieldProtocolId } from '@/lib/yield/interface';
import { getVenue } from './registry';

/**
 * Legacy / stale protocol IDs that can still appear in old database
 * rows even though they're no longer in the VENUES registry. Display
 * something sensible instead of the raw slug.
 *
 * The original `'morpho'` enum value used to live here. Migration
 * 0037_delete_legacy_morpho_rows.sql removes the rows, so the fallback
 * is no longer needed and was dropped in the same release.
 */
const LEGACY_DISPLAY_NAMES: Record<string, string> = {
  maple: 'Maple (deprecated)',
  _maple_deprecated: 'Maple (deprecated)',
  drift: 'Drift (removed)',
};

/**
 * Per-protocol static logo paths under `public/partners/`.
 *
 * Tokenized MMFs don't currently ship with logos — they render as a
 * text-only header in the card layout. If we add partner logos for
 * them later, drop the file into `public/partners/` and add a row
 * here.
 */
const VENUE_LOGOS: Partial<Record<YieldProtocolId, string>> = {
  aave_v3:           '/partners/Aave_idWRQ7YLO7_0.svg',
  compound_v3:       '/partners/compound-white.png',
  morpho_reservoir:  '/partners/morpho-white.svg',
  morpho_steakhouse: '/partners/morpho-white.svg',
  kamino:            '/partners/kamino-logo.svg',
  kamino_multiply:   '/partners/kamino-logo.svg',
  ondo_usdy:         '/partners/Ondo_Logo_0.svg',
  sky:               '/partners/sky_logo.png',
  ethena:            '/partners/ethena_logo.png',
};

/**
 * Get the human-readable display name for a venue by protocol ID.
 *
 * Resolution order:
 *   1. VENUES registry (canonical — what the Yield Explorer uses)
 *   2. Legacy fallback map (for stale DB rows referencing removed venues)
 *   3. The raw protocol ID as a last resort (never throws)
 *
 * This is the function every UI component should call instead of
 * maintaining its own PROTOCOL_LABELS record. Takes an unknown string
 * on purpose — `yield_positions.protocol` is typed as a Postgres enum
 * that can contain values not in the current TS union, so callers
 * shouldn't have to narrow before calling.
 */
export function getVenueDisplayName(protocolId: string | null | undefined): string {
  if (!protocolId) return 'Unknown';
  const venue = getVenue(protocolId as YieldProtocolId);
  if (venue) return venue.displayName;
  if (LEGACY_DISPLAY_NAMES[protocolId]) return LEGACY_DISPLAY_NAMES[protocolId];
  // Final fallback: title-case the raw slug so we never render
  // something like `spiko_usd` or `morpho_steakhouse` in the UI.
  // Tokens that look like all-caps tickers (USDC, OUSG, USYC, BUIDL)
  // are kept uppercase; everything else is capitalized.
  return protocolId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[a-z]{3,5}$/.test(part) && /^(usdc|usdt|usdy|ousg|usyc|ustb|buidl|benji|busd|dai|sky|aave)$/.test(part)) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * Get the logo path for a venue. Returns null if no logo is registered
 * — callers should render a text-only title in that case.
 */
export function getVenueLogoPath(protocolId: string | null | undefined): string | null {
  if (!protocolId) return null;
  return VENUE_LOGOS[protocolId as YieldProtocolId] ?? null;
}
