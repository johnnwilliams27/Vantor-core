/**
 * Holdings → treasury card placement.
 *
 * Pure, deterministic function: given a holding (bank balance, wallet
 * balance, or yield position), return which of the treasury cards it
 * belongs in. Never stored, always recomputed — the card placement is a
 * function of the underlying venue and asset, not a separate field that
 * can drift.
 *
 * The four buckets:
 *   - **cash** — bank/fiat balances AND tokenized MMF positions. Tokenized
 *     MMFs are cash equivalents in a treasurer's mental model: regulated
 *     fund shares backed by short-term Treasuries, not a DeFi yield venue.
 *   - **stablecoin** — idle stablecoin balances (USDC, USDT) held in a
 *     self-custody wallet and NOT currently deployed to a venue.
 *   - **defi_positions** — yield positions in a DeFi vault or DeFi
 *     lending market. Covers Aave, Compound, Morpho vaults, Kamino, etc.
 *   - **other** — fallback for anything the categorizer doesn't recognize.
 *     Rolls up into Total Treasury so nothing is dropped.
 */

import { getVenue, isDeFiCategory } from '@/lib/yield/venues';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';

export type CardPlacement = 'cash' | 'stablecoin' | 'defi_positions' | 'other';

/**
 * The set of tokens we consider "idle stablecoin balance" — i.e. wallet
 * balances in these tokens go into the Stablecoins card when not deployed.
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
 * Determine which treasury card a holding belongs in. Pure function, no
 * side effects, no async.
 *
 * The venue lookup is the only non-trivial branch: a `yield_position` in
 * a venue with `category='tokenized_mmf'` goes to **cash**, while the
 * same holding in a `defi_vault` or `defi_lending_market` goes to
 * **defi_positions**. If the venue is unknown (e.g. a stale enum value
 * that was removed), we fall through to 'other' — the holding still
 * counts toward total treasury, it just doesn't surface in a specific
 * card.
 */
export function getHoldingCardPlacement(
  holding: HoldingForCategorization,
): CardPlacement {
  switch (holding.kind) {
    case 'bank_balance':
      return 'cash';

    case 'wallet_balance':
      return STABLECOIN_TOKENS.has(holding.token) ? 'stablecoin' : 'other';

    case 'yield_position': {
      const venue = getVenue(holding.protocol);
      if (!venue) return 'other';
      if (venue.category === 'tokenized_mmf') return 'cash';
      if (isDeFiCategory(venue.category)) return 'defi_positions';
      return 'other';
    }
  }
}
