import { SUPPORTED_FIAT_CURRENCIES, getFxRate, type FiatCurrency } from '@/lib/fx/rates';

function isSupportedFiat(c: string): c is FiatCurrency {
  return (SUPPORTED_FIAT_CURRENCIES as readonly string[]).includes(c);
}

/** Default pessimistic haircut (500 bps = 5%) applied to obligation FX. */
export const DEFAULT_PESSIMISTIC_BPS = 500;

/**
 * Convert a native obligation amount to USD using the pessimistic FX strategy.
 * "Pessimistic" for obligations means shifting the rate UP (not down) —
 * rules-engine gates need to over-estimate what you owe, not under-estimate.
 * So a 5% pessimistic bps shift multiplies the live rate by 1.05, inflating
 * the USD-equivalent obligation amount.
 *
 * Note: ForecastService's `buildFxRates` uses the opposite direction (*0.95)
 * because it's valuing ASSETS conservatively (fewer USD per foreign unit).
 * Obligation FX flips that — the same "pessimistic" word, different direction
 * given the liability framing.
 *
 * Stablecoins (USDC/USDT) and unsupported currencies fall through as 1:1 USD.
 * USDC/USDT peg drift is tiny and the fx_rate_cache doesn't cover them; treat
 * them as dollar-denominated for obligation math.
 *
 * Lookup is fresh every call — callers need current rates, not whatever was
 * in effect when the obligation row was written.
 */
export function obligationAmountToUsdPessimistic(
  amount: number,
  currency: string,
  bpsShift: number = DEFAULT_PESSIMISTIC_BPS,
): number {
  if (currency === 'USD' || !isSupportedFiat(currency)) {
    return amount;
  }
  const liveRate = getFxRate(currency, 'USD');
  const adjusted = liveRate * (1 + bpsShift / 10_000);
  return amount * adjusted;
}
