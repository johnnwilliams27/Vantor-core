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
    // Import from src/ to confirm the @/ alias resolves correctly
    const mod = await import('@/lib/treasury/oracle');
    expect(typeof mod.getStablecoinPrices).toBe('function');
  });
});
