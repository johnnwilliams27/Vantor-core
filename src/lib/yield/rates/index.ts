import { aaveFetcher } from './aave';
import { compoundFetcher } from './compound';
import { morphoFetcher } from './morpho';
import { skyFetcher } from './sky';
import { ondoFetcher } from './ondo';
import { ethenaFetcher } from './ethena';
import { mapleFetcher } from './maple';
import { kaminoFetcher } from './kamino';
import { driftFetcher } from './drift';
import type { RateFetcher, RateResult } from './types';

export type { RateResult, RateFetcher };

export const ALL_RATE_FETCHERS: { name: string; fetcher: RateFetcher }[] = [
  { name: 'aave', fetcher: aaveFetcher },
  { name: 'compound', fetcher: compoundFetcher },
  { name: 'morpho', fetcher: morphoFetcher },
  { name: 'sky', fetcher: skyFetcher },
  { name: 'ondo', fetcher: ondoFetcher },
  { name: 'ethena', fetcher: ethenaFetcher },
  { name: 'maple', fetcher: mapleFetcher },
  { name: 'kamino', fetcher: kaminoFetcher },
  { name: 'drift', fetcher: driftFetcher },
];

export async function fetchAllRates(): Promise<{
  rates: RateResult[];
  failures: { name: string; error: string }[];
}> {
  const settled = await Promise.allSettled(
    ALL_RATE_FETCHERS.map(async ({ name, fetcher }) => {
      const rates = await fetcher.fetchRates();
      return { name, rates };
    }),
  );

  const rates: RateResult[] = [];
  const failures: { name: string; error: string }[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      rates.push(...result.value.rates);
    } else {
      const idx = settled.indexOf(result);
      const name = ALL_RATE_FETCHERS[idx]?.name ?? 'unknown';
      failures.push({ name, error: result.reason?.message || String(result.reason) });
    }
  }

  return { rates, failures };
}
