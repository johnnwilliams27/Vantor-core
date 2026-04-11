import { describe, it, expect, vi, afterEach } from 'vitest';
import { getStablecoinPricesStrict } from './oracle';

function mockFetchResponse(json: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => json,
  } as unknown as Response;
}

function mockFetchJsonError(message: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new Error(message);
    },
  } as unknown as Response;
}

describe('getStablecoinPricesStrict', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete process.env.COINGECKO_USE_MOCK;
  });

  it('happy path: returns prices, source, and fetchedAt when CoinGecko returns valid JSON', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          'usd-coin': { usd: 1.0001 },
          tether: { usd: 0.9999 },
        }),
      ),
    );

    const result = await getStablecoinPricesStrict();
    expect(result.prices.USDC).toBe(1.0001);
    expect(result.prices.USDT).toBe(0.9999);
    expect(result.source).toBe('coingecko');
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it('rejects mock mode (COINGECKO_USE_MOCK=true)', async () => {
    process.env.COINGECKO_USE_MOCK = 'true';
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/COINGECKO_USE_MOCK/);
  });

  it('throws on non-OK HTTP status', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchResponse({}, false, 503)),
    );
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/503/);
  });

  it('throws on network error (fetch rejects)', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/ECONNRESET/);
  });

  it('throws when response body is invalid JSON', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockFetchJsonError('Unexpected token')),
    );
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/not valid JSON/);
  });

  it('throws when usd-coin field is missing', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          tether: { usd: 1 },
        }),
      ),
    );
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/missing or non-numeric/);
  });

  it('throws when usdc price is non-numeric (string)', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          'usd-coin': { usd: 'NaN' },
          tether: { usd: 1 },
        }),
      ),
    );
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/missing or non-numeric/);
  });

  it('throws on zero usdc price', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          'usd-coin': { usd: 0 },
          tether: { usd: 1 },
        }),
      ),
    );
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/invalid prices/);
  });

  it('throws on negative usdt price', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          'usd-coin': { usd: 1 },
          tether: { usd: -0.5 },
        }),
      ),
    );
    await expect(getStablecoinPricesStrict()).rejects.toThrow(/invalid prices/);
  });

  it('fetchedAt is a finite Date set before fetch resolves', async () => {
    delete process.env.COINGECKO_USE_MOCK;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockFetchResponse({
          'usd-coin': { usd: 1 },
          tether: { usd: 1 },
        }),
      ),
    );

    const before = Date.now();
    const result = await getStablecoinPricesStrict();
    const after = Date.now();

    expect(result.fetchedAt).toBeInstanceOf(Date);
    expect(Number.isFinite(result.fetchedAt.getTime())).toBe(true);
    expect(result.fetchedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.fetchedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
