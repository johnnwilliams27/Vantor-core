import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchStablecoinPricesWithTimestamp } from './oracle-adapter';

// Mock both helpers so we can verify which one is called per branch.
vi.mock('@/lib/treasury/oracle', () => ({
  getStablecoinPrices: vi.fn(),
  getStablecoinPricesStrict: vi.fn(),
}));

import { getStablecoinPrices, getStablecoinPricesStrict } from '@/lib/treasury/oracle';

describe('fetchStablecoinPricesWithTimestamp', () => {
  const originalEnv = process.env.COINGECKO_USE_MOCK;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.COINGECKO_USE_MOCK;
    } else {
      process.env.COINGECKO_USE_MOCK = originalEnv;
    }
  });

  it('uses the strict helper in production mode (env unset)', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    const fetchedAt = new Date('2026-04-11T10:00:00.000Z');
    vi.mocked(getStablecoinPricesStrict).mockResolvedValue({
      prices: { USDC: 1.0001, USDT: 0.9999 },
      source: 'coingecko',
      fetchedAt,
    });

    const result = await fetchStablecoinPricesWithTimestamp();

    expect(getStablecoinPricesStrict).toHaveBeenCalledTimes(1);
    expect(getStablecoinPrices).not.toHaveBeenCalled();
    expect(result.source).toBe('coingecko');
    // strict helper's timestamp, not new Date()
    expect(result.fetchedAt).toBe(fetchedAt);
    expect(result.prices.USDC).toBe(1.0001);
    expect(result.prices.USDT).toBe(0.9999);
  });

  it('uses the strict helper when COINGECKO_USE_MOCK is set to anything other than "true"', async () => {
    process.env.COINGECKO_USE_MOCK = 'false';
    vi.mocked(getStablecoinPricesStrict).mockResolvedValue({
      prices: { USDC: 1, USDT: 1 },
      source: 'coingecko',
      fetchedAt: new Date(),
    });

    await fetchStablecoinPricesWithTimestamp();

    expect(getStablecoinPricesStrict).toHaveBeenCalledTimes(1);
    expect(getStablecoinPrices).not.toHaveBeenCalled();
  });

  it('uses the strict helper when COINGECKO_USE_MOCK="1" (only exact string "true" triggers mock)', async () => {
    process.env.COINGECKO_USE_MOCK = '1';
    vi.mocked(getStablecoinPricesStrict).mockResolvedValue({
      prices: { USDC: 1, USDT: 1 },
      source: 'coingecko',
      fetchedAt: new Date(),
    });

    await fetchStablecoinPricesWithTimestamp();

    expect(getStablecoinPricesStrict).toHaveBeenCalledTimes(1);
    expect(getStablecoinPrices).not.toHaveBeenCalled();
  });

  it('uses the fail-open helper in mock mode (COINGECKO_USE_MOCK=true)', async () => {
    process.env.COINGECKO_USE_MOCK = 'true';
    vi.mocked(getStablecoinPrices).mockResolvedValue({
      prices: { USDC: 1, USDT: 1 },
      source: 'mock',
    });

    const result = await fetchStablecoinPricesWithTimestamp();

    expect(getStablecoinPrices).toHaveBeenCalledTimes(1);
    expect(getStablecoinPricesStrict).not.toHaveBeenCalled();
    expect(result.source).toBe('mock');
    // adapter stamps it via new Date() in the mock branch
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('propagates strict helper errors unwrapped (so the policy provider can map them)', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    const oracleError = new Error('CoinGecko returned non-OK status 503');
    vi.mocked(getStablecoinPricesStrict).mockRejectedValue(oracleError);

    await expect(fetchStablecoinPricesWithTimestamp()).rejects.toThrow(
      'CoinGecko returned non-OK status 503',
    );
  });
});
