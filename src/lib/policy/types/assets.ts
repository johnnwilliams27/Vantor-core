// src/lib/policy/types/assets.ts

/**
 * Asset codes the policy engine recognizes in phase 1.
 * Expansion requires adding here AND adding a rate source in the
 * canonicalizer's PolicyRateProvider implementation (for USD-comparable
 * assets) OR leaving as native-only.
 */
export type AssetCode =
  | 'USD'
  | 'USDC'
  | 'USDT'
  // Future: 'EUR', 'GBP', 'BTC', 'ETH', 'DAI', 'PYUSD', etc.
  | (string & { readonly __brand?: 'AssetCode' });  // open-ended brand for extensibility

/**
 * Stable identifier for a venue (chain, exchange, bank).
 * Matches existing wallet venue values (e.g., 'ethereum', 'solana', 'svb', 'mercury').
 */
export type VenueId = string;

/**
 * Native-denominated amount. The amount is a decimal string to avoid
 * JavaScript float precision loss. Never use `number` for monetary values
 * at the policy engine boundary.
 */
export interface AmountNative {
  amount: string;    // Decimal string (e.g., "500000" or "1234567.89")
  asset: AssetCode;
}

/**
 * A currency-tagged amount used in rule values and hard limits.
 * The `currency` field is required to make comparisons explicit —
 * there is no implied "default currency." Native-unit rules use the
 * asset code here; USD-denominated rules use 'USD'.
 */
export interface AmountValue {
  amount: string;    // Decimal string
  currency: AssetCode;
}
