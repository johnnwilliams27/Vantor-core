import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoingeckoPolicyRateProvider } from './coingecko-provider';
import { CanonicalizationSourceUnavailableError } from '../errors/classes';
import { POLICY_RATE_MAX_AGE_MS } from './interface';

describe('CoingeckoPolicyRateProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T14:22:33.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 1.0 rate for USD → USD with current timestamp', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn(), // not called for USD passthrough
    });

    const reading = await provider.getRateAsOf('USD', 'USD', new Date());

    expect(reading.rate).toBe('1');
    expect(reading.source).toBe('passthrough');
    expect(reading.asOfRate).toBeInstanceOf(Date);
    expect(reading.maxAgeMs).toBe(POLICY_RATE_MAX_AGE_MS);
  });

  it('returns rate from oracle for USDC → USD when source is fresh', async () => {
    const fetchedAt = new Date('2026-04-10T14:22:33.000Z');
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt,
      }),
    });

    const reading = await provider.getRateAsOf('USDC', 'USD', new Date());

    expect(reading.rate).toBe('1.0002');
    expect(reading.source).toBe('coingecko');
    expect(reading.asOfRate.getTime()).toBe(fetchedAt.getTime());
  });

  it('returns rate from oracle for USDT → USD', async () => {
    const fetchedAt = new Date('2026-04-10T14:22:33.000Z');
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 0.9998 },
        source: 'coingecko',
        fetchedAt,
      }),
    });

    const reading = await provider.getRateAsOf('USDT', 'USD', new Date());

    expect(reading.rate).toBe('0.9998');
  });

  it('throws canonicalization_source_unavailable when oracle source is "mock" in production mode', async () => {
    // Mock-mode oracle returns 1.0 fallback — we explicitly reject it for policy
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0, USDT: 1.0 },
        source: 'mock', // the oracle tells us it's in mock mode
        fetchedAt: new Date(),
      }),
      acceptMockSource: false, // production mode
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toThrow(
      CanonicalizationSourceUnavailableError,
    );
    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
    });
  });

  it('accepts mock-mode oracle when acceptMockSource=true (for dev/test)', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0, USDT: 1.0 },
        source: 'mock',
        fetchedAt: new Date(),
      }),
      acceptMockSource: true,
    });

    const reading = await provider.getRateAsOf('USDC', 'USD', new Date());
    expect(reading.rate).toBe('1');
    expect(reading.source).toBe('mock');
  });

  it('throws canonicalization_rate_stale when the oracle reading is older than max_age_ms', async () => {
    // Oracle fetched 2 minutes ago, max_age is 60s
    const twoMinutesAgo = new Date(Date.now() - 120_000);
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt: twoMinutesAgo,
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_rate_stale',
    });
  });

  it('throws canonicalization_failed (unsupported_asset) for BTC', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('BTC' as never, 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
    await expect(provider.getRateAsOf('BTC' as never, 'USD', new Date())).rejects.toThrow(/unsupported/i);
  });

  it('throws canonicalization_source_unavailable when the oracle fetcher throws', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockRejectedValue(new Error('network error')),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
    });
  });

  it('throws canonicalization_source_unavailable when fetchedAt is in the future (clock skew)', async () => {
    // Future-dated fetchedAt → negative ageMs. Must not be treated as fresh.
    const tenSecondsInFuture = new Date(Date.now() + 10_000);
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt: tenSecondsInFuture,
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
    });
    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      details: { reason: 'fetched_at_in_future' },
    });
  });
});
