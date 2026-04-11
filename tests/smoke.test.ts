import { describe, it, expect } from 'vitest';

describe('vitest smoke test', () => {
  it('runs basic assertions', () => {
    expect(1 + 1).toBe(2);
  });

  it('handles async code', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });

  it('supports the @/ path alias', async () => {
    // Import something trivial from src to confirm alias works
    const { oracle } = await import('@/lib/treasury/oracle').then(m => ({ oracle: m.getStablecoinPrices }));
    expect(typeof oracle).toBe('function');
  });
});
