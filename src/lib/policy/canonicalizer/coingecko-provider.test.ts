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

  it('throws canonicalization_source_unavailable when fetchedAt is an Invalid Date', async () => {
    // `new Date('not-a-date')` is a Date instance whose .getTime() returns NaN.
    // Both the future and stale comparisons short-circuit on NaN, so without a
    // dedicated guard the Invalid Date would flow into asOfRate and defeat the
    // staleness guard entirely.
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt: new Date('not-a-date'),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
      details: { reason: 'fetched_at_invalid' },
    });
  });

  it('throws canonicalization_source_unavailable when fetchedAt is a string (non-Date)', async () => {
    // A future JSON cache/RPC layer could return fetchedAt as a string without
    // revival. Calling .getTime() on a string throws TypeError, escaping the
    // structured-error contract — must be caught as a shape issue.
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source: 'coingecko',
        fetchedAt: '2026-04-10T14:22:33.000Z' as unknown as Date,
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
      details: { reason: 'fetched_at_not_date' },
    });
  });

  it('throws canonicalization_source_unavailable when prices payload is null', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: null as unknown as Record<string, number>,
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
      details: { reason: 'prices_malformed' },
    });
  });

  it('throws canonicalization_failed when the requested asset rate value is null', async () => {
    // prices is a valid object but the specific asset's rate is null — hits the
    // `rateNumber == null` branch after shape validation passes.
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: null as unknown as number, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
  });

  it('throws canonicalization_failed when rate is exactly zero (defense in depth)', async () => {
    // `String(0)` is `'0'`, which matches the non-negative-decimal regex. Without
    // the `<= 0` guard, a buggy oracle returning zero would silently neutralize
    // every USD-denominated threshold check (multiplied by zero rate).
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 0, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
  });

  it('throws canonicalization_failed when rate is negative (-0.5)', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: -0.5, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
  });

  it('throws canonicalization_failed when rate is negative (-1)', async () => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: -1, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
  });

  it('throws canonicalization_failed when rate serializes to scientific notation (1e-10)', async () => {
    // `String(1e-10)` is `'1e-10'`, which fails the decimal-string regex.
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1e-10, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
  });

  it('throws canonicalization_failed when rate serializes to scientific notation (1e21)', async () => {
    // `String(1e21)` is `'1e+21'`, which fails the decimal-string regex. The
    // `<= 0` check passes (1e21 > 0), so this exercises the rate-precision path.
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1e21, USDT: 1.0 },
        source: 'coingecko',
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_failed',
    });
  });

  it.each([
    ['cache'],
    ['fallback'],
    ['stub'],
    [''],
    ['CoinGecko'], // case drift
  ])('rejects unknown source %j with canonicalization_source_unavailable', async (source) => {
    const provider = new CoingeckoPolicyRateProvider({
      fetchStablecoinPrices: vi.fn().mockResolvedValue({
        prices: { USDC: 1.0002, USDT: 1.0001 },
        source,
        fetchedAt: new Date(),
      }),
    });

    await expect(provider.getRateAsOf('USDC', 'USD', new Date())).rejects.toMatchObject({
      reason_code: 'canonicalization_source_unavailable',
    });
  });
});
