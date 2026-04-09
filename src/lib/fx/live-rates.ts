import type { FiatCurrency } from './rates';

const API_KEY = process.env.EXCHANGERATES_API_KEY;
const BASE_URL = 'https://api.exchangeratesapi.io/v1';
const SUPPORTED_TARGETS: FiatCurrency[] = ['EUR', 'GBP', 'BRL', 'MXN'];

export interface FxRateResult {
  rates: Record<string, number>;
  fetchedAt: string;
}

/**
 * Fetch live FX rates from exchangeratesapi.io (base USD).
 * Returns rates as USD → target (e.g. USD → BRL = 5.05).
 */
export async function fetchLiveFxRates(): Promise<FxRateResult> {
  if (!API_KEY) {
    throw new Error('EXCHANGERATES_API_KEY not configured');
  }

  const symbols = SUPPORTED_TARGETS.join(',');
  // exchangeratesapi.io free tier uses EUR as base, so we fetch EUR-based and convert
  const res = await fetch(
    `${BASE_URL}/latest?access_key=${API_KEY}&symbols=USD,${symbols}&format=1`,
  );

  if (!res.ok) {
    throw new Error(`exchangeratesapi.io returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  if (!data.success) {
    throw new Error(`exchangeratesapi.io error: ${JSON.stringify(data.error)}`);
  }

  // API returns EUR-based rates; convert to USD-based
  const eurToUsd = data.rates?.USD;
  if (!eurToUsd) {
    throw new Error('USD rate missing from exchangeratesapi.io response');
  }

  const usdBasedRates: Record<string, number> = { USD: 1 };
  for (const currency of SUPPORTED_TARGETS) {
    const eurToTarget = data.rates?.[currency];
    if (eurToTarget) {
      usdBasedRates[currency] = eurToTarget / eurToUsd;
    }
  }

  return {
    rates: usdBasedRates,
    fetchedAt: new Date().toISOString(),
  };
}
