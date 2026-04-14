import { describe, it, expect, vi } from 'vitest';
import { isExpiringSoon, computeExpiresAt } from '@/lib/erp/real/xero/tokens';

describe('tokens pure helpers', () => {
  it('isExpiringSoon returns true within 60s of expiry', () => {
    const now = new Date('2025-04-10T12:00:00Z');
    vi.setSystemTime(now);
    expect(isExpiringSoon(new Date('2025-04-10T12:00:30Z'))).toBe(true);
    expect(isExpiringSoon(new Date('2025-04-10T12:01:30Z'))).toBe(false);
    vi.useRealTimers();
  });

  it('computeExpiresAt adds expires_in seconds to now', () => {
    const now = new Date('2025-04-10T12:00:00Z');
    vi.setSystemTime(now);
    const result = computeExpiresAt(1800);
    expect(result.toISOString()).toBe('2025-04-10T12:30:00.000Z');
    vi.useRealTimers();
  });
});
