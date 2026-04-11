import { describe, it, expect, vi } from 'vitest';
import { canonicalizeToUsd, buildCanonicalizationResult } from './canonicalizer';
import { CoingeckoPolicyRateProvider } from './coingecko-provider';
import { CanonicalizationError } from '../errors/classes';

describe('canonicalizeToUsd', () => {
  const makeProvider = (prices: Record<string, number>) =>
    new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices,
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

  it('converts USDC to USD at the current rate', async () => {
    const provider = makeProvider({ USDC: 1.0002, USDT: 1.0001 });
    const result = await canonicalizeToUsd(
      { amount: '50000', asset: 'USDC' },
      provider,
      new Date(),
    );
    // 50000 * 1.0002 = 50010
    expect(result.canonical_amount).toBe('50010');
    expect(result.native_amount).toBe('50000');
    expect(result.native_asset).toBe('USDC');
    expect(result.canonical_currency).toBe('USD');
    expect(result.rate).toBe('1.0002');
  });

  it('passes USD through as 1:1', async () => {
    const provider = makeProvider({ USDC: 1, USDT: 1 });
    const result = await canonicalizeToUsd(
      { amount: '75000.50', asset: 'USD' },
      provider,
      new Date(),
    );
    expect(result.canonical_amount).toBe('75000.5');
    expect(result.rate).toBe('1');
  });

  it('populates failure field when rate provider throws', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const result = await canonicalizeToUsd(
      { amount: '1000', asset: 'USDC' },
      provider,
      new Date(),
    );
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_source_unavailable');
    expect(result.canonical_amount).toBe('');
  });

  it('populates failure field for unsupported assets', async () => {
    const provider = makeProvider({ USDC: 1, USDT: 1 });
    const result = await canonicalizeToUsd(
      // AssetCode is a closed union ('USD' | 'USDC' | 'USDT'); cast to bypass
      // the type system and exercise the runtime unsupported-asset guard.
      { amount: '1', asset: 'BTC' as never },
      provider,
      new Date(),
    );
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});

describe('buildCanonicalizationResult', () => {
  it('builds a success result with a rate reading', () => {
    const result = buildCanonicalizationResult({
      nativeAmount: '1000',
      nativeAsset: 'USDC',
      rateReading: {
        rate: '1.0002',
        source: 'coingecko',
        asOfRate: new Date('2026-04-10T14:22:33.000Z'),
        maxAgeMs: 60_000,
      },
    });
    expect(result.canonical_amount).toBe('1000.2');
    expect(result.rate_source).toBe('coingecko');
    expect(result.failure).toBeUndefined();
  });

  it('builds a failure result with an error', () => {
    const result = buildCanonicalizationResult({
      nativeAmount: '1000',
      nativeAsset: 'USDC',
      error: new CanonicalizationError({
        human_readable: 'BTC unsupported',
        user_action: 'Remove BTC from the rule scope.',
        details: { from_asset: 'BTC' },
      }),
    });
    expect(result.canonical_amount).toBe('');
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason_code).toBe('canonicalization_failed');
  });
});
