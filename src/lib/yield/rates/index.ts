import { aaveFetcher } from './aave';
import { compoundFetcher } from './compound';
import { morphoFetcher } from './morpho';
import { skyFetcher } from './sky';
import { ondoFetcher } from './ondo';
import { ethenaFetcher } from './ethena';
import { kaminoFetcher } from './kamino';
import type { RateFetcher, RateResult } from './types';

export type { RateResult, RateFetcher };

export type RateKey = { protocol: string; token: string; chain: string };

/**
 * Canonical set of (protocol, token, chain) tuples that the fetchers above are
 * allowed to emit. Used by the cron route to sweep orphaned rows out of
 * `yield_rate_cache` when a venue is retired or a fetcher stops emitting a
 * tuple (e.g. the 2026-04-19 `kamino_multiply` removal). Keep this in sync
 * with the fetcher implementations.
 */
export const DECLARED_RATE_KEYS: ReadonlyArray<RateKey> = [
  { protocol: 'aave', token: 'USDC', chain: 'ethereum' },
  { protocol: 'aave', token: 'USDT', chain: 'ethereum' },
  { protocol: 'compound', token: 'USDC', chain: 'ethereum' },
  { protocol: 'compound', token: 'USDT', chain: 'ethereum' },
  { protocol: 'morpho_steakhouse', token: 'USDC', chain: 'ethereum' },
  { protocol: 'morpho_reservoir', token: 'USDC', chain: 'ethereum' },
  { protocol: 'sky', token: 'USDC', chain: 'ethereum' },
  { protocol: 'sky', token: 'USDT', chain: 'ethereum' },
  { protocol: 'ondo_usdy', token: 'USDC', chain: 'ethereum' },
  { protocol: 'ethena', token: 'USDC', chain: 'ethereum' },
  { protocol: 'ethena', token: 'USDT', chain: 'ethereum' },
  { protocol: 'kamino', token: 'USDC', chain: 'solana' },
  { protocol: 'kamino', token: 'USDT', chain: 'solana' },
];

export const ALL_RATE_FETCHERS: { name: string; fetcher: RateFetcher }[] = [
  { name: 'aave', fetcher: aaveFetcher },
  { name: 'compound', fetcher: compoundFetcher },
  { name: 'morpho_reservoir', fetcher: morphoFetcher },
  { name: 'sky', fetcher: skyFetcher },
  { name: 'ondo_usdy', fetcher: ondoFetcher },
  { name: 'ethena', fetcher: ethenaFetcher },
  { name: 'kamino', fetcher: kaminoFetcher },
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
