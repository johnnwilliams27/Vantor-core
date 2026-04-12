/**
 * Holdings → treasury taxonomy classification.
 *
 * Two layers:
 *
 *   - `getHoldingTaxonomy()` — canonical L3-leaf classification used by the
 *     snapshot writer to populate the aggregate columns on
 *     `treasury_state_snapshots`. Returns one of six placements that map
 *     directly to Vantor's published treasury taxonomy:
 *
 *        Cash & Equivalents  →  'cash' | 'stablecoin'
 *        Yield Positions     →  'mmf' | 'defi_vault' | 'defi_lending'
 *        (catch-all)         →  'other'
 *
 *   - `getHoldingCardPlacement()` — the legacy 4-bucket display model. Kept
 *     for backwards-compat with consumers that haven't migrated to the
 *     new taxonomy yet (Treasury AI overview, Report Builder, Insights, etc.).
 *     Delegates to `getHoldingTaxonomy()` internally so the two can't drift:
 *     MMFs collapse into 'cash', DeFi vault/lending collapse into
 *     'defi_positions'.
 *
 * Both are pure, deterministic functions — no side effects, no async.
 */

import { getVenue } from '@/lib/yield/venues';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';

export type CardPlacement = 'cash' | 'stablecoin' | 'defi_positions' | 'other';

/**
 * Full Vantor treasury taxonomy — L3 leaves. See the taxonomy tree in
 * `docs/architecture/forecast-analytics.md` (Phase C-1.5 section).
 */
export type HoldingTaxonomy =
  | 'cash' // bank balances (off-chain, multi-currency)
  | 'stablecoin' // idle USDC/USDT in self-custody wallets
  | 'mmf' // tokenized money-market funds (Spiko, BUIDL, USYC, Ondo USDY, …)
  | 'defi_vault' // DeFi vault protocols (Kamino Multiply, Morpho Reservoir, …)
  | 'defi_lending' // DeFi lending protocols (Aave V3, Compound V3, Kamino Lend)
  | 'other'; // fallback — ETH/SOL/misc wallet tokens and unknown venues

/**
 * The set of tokens we consider "idle stablecoin balance" — i.e. wallet
 * balances in these tokens go into the Stablecoins leaf when not deployed.
 *
 * Keep in sync with `token_symbol` enum in Postgres. Non-stable wallet
 * holdings (ETH, SOL, etc.) fall through to 'other'.
 */
const STABLECOIN_TOKENS: ReadonlySet<TokenSymbol> = new Set<TokenSymbol>([
  'USDC',
  'USDT',
]);

export type HoldingForCategorization =
  | { kind: 'bank_balance' }
  | { kind: 'wallet_balance'; token: TokenSymbol }
  | { kind: 'yield_position'; protocol: YieldProtocolId };

/**
 * Classify a holding into its canonical L3 leaf.
 *
 * The venue lookup is the only non-trivial branch: for yield positions we
 * inspect `venue.category` and route to the matching leaf. Unknown venues
 * (e.g. stale registry entries) fall through to 'other' so the holding
 * still counts toward total treasury, just not toward a specific leaf.
 */
export function getHoldingTaxonomy(
  holding: HoldingForCategorization,
): HoldingTaxonomy {
  switch (holding.kind) {
    case 'bank_balance':
      return 'cash';

    case 'wallet_balance':
      return STABLECOIN_TOKENS.has(holding.token) ? 'stablecoin' : 'other';

    case 'yield_position': {
      const venue = getVenue(holding.protocol);
      if (!venue) return 'other';
      if (venue.category === 'tokenized_mmf') return 'mmf';
      if (venue.category === 'defi_vault') return 'defi_vault';
      if (venue.category === 'defi_lending_market') return 'defi_lending';
      return 'other';
    }
  }
}

/**
 * Legacy 4-bucket card placement. Delegates to `getHoldingTaxonomy()` and
 * collapses MMFs into 'cash' and DeFi vault/lending into 'defi_positions'.
 *
 * Preserved for backwards-compat with consumers that still read the
 * pre-Phase C-1.5 display model. New code should use `getHoldingTaxonomy()`.
 */
export function getHoldingCardPlacement(
  holding: HoldingForCategorization,
): CardPlacement {
  const tax = getHoldingTaxonomy(holding);
  switch (tax) {
    case 'cash':
    case 'mmf':
      // In the legacy 4-bucket model, tokenized MMFs are cash-equivalents.
      // (The new taxonomy separates them, but card consumers aren't migrated.)
      return 'cash';
    case 'stablecoin':
      return 'stablecoin';
    case 'defi_vault':
    case 'defi_lending':
      return 'defi_positions';
    case 'other':
      return 'other';
  }
}

