export const SUPPORTED_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN'] as const;
export type FiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number];

/**
 * Mock FX rates relative to USD.
 * In production, replace with a real FX API (e.g., exchangeratesapi.io).
 */
const MOCK_RATES: Record<FiatCurrency, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  BRL: 5.05,
  MXN: 17.15,
};

export function getMockFxRates(): Record<FiatCurrency, number> {
  return { ...MOCK_RATES };
}

export function getFxRate(from: FiatCurrency, to: FiatCurrency): number {
  if (from === to) return 1;
  const fromToUsd = 1 / MOCK_RATES[from];
  return fromToUsd * MOCK_RATES[to];
}

export function convertFiat(amount: number, from: FiatCurrency, to: FiatCurrency): number {
  return amount * getFxRate(from, to);
}

const CURRENCY_SYMBOLS: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  BRL: 'R$',
  MXN: 'MX$',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency as FiatCurrency] ?? currency;
}

export function formatFiatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
