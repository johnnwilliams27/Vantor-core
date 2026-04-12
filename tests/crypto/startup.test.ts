import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetCipherProviderForTests } from '@/lib/crypto/provider';

const HEX64 = 'a'.repeat(64);

describe('instrumentation.ts register()', () => {
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = { ...process.env };
    __resetCipherProviderForTests();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetCipherProviderForTests();
  });

  it('succeeds when CREDENTIALS_ENCRYPTION_KEY is set', async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = HEX64;
    process.env.CREDENTIALS_ENCRYPTION_KEY_ID = 'test-v1';
    process.env.NEXT_RUNTIME = 'nodejs';
    // Stub Sentry imports so they don't error in tests
    vi.mock('../sentry.server.config', () => ({}));
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.not.toThrow();
  });

  it('throws CRYPTO_MISSING_KEY when the primary env var is missing', async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.NEXT_RUNTIME = 'nodejs';
    vi.mock('../sentry.server.config', () => ({}));
    const { register } = await import('@/instrumentation');
    await expect(register()).rejects.toMatchObject({ code: 'CRYPTO_MISSING_KEY' });
  });

  it('does nothing when runtime is edge', async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.NEXT_RUNTIME = 'edge';
    vi.mock('../sentry.edge.config', () => ({}));
    const { register } = await import('@/instrumentation');
    // Should not throw — crypto check is in the nodejs branch only.
    await expect(register()).resolves.not.toThrow();
  });
});
