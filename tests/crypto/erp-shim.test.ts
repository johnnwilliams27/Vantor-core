import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetCipherProviderForTests } from '@/lib/crypto/provider';

const HEX64 = 'a'.repeat(64);

describe('ERP credential shim', () => {
  let originalEnv: typeof process.env;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.CREDENTIALS_ENCRYPTION_KEY = HEX64;
    process.env.CREDENTIALS_ENCRYPTION_KEY_ID = 'test-v1';
    delete process.env.CREDENTIALS_ENCRYPTION_KEY_LEGACY;
    delete process.env.CRYPTO_PROVIDER;
    __resetCipherProviderForTests();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetCipherProviderForTests();
  });

  it('encryptCredentials → decryptCredentials round-trips an ERPCredentials object', async () => {
    const { encryptCredentials, decryptCredentials } = await import('@/lib/erp/factory');
    const original = {
      apiUrl: 'https://api.xero.com',
      clientId: 'ci',
      clientSecret: 'cs',
    };
    const envelope = await encryptCredentials(original);
    expect(envelope).toMatch(/^v1:test-v1:/);
    const roundTripped = await decryptCredentials(envelope);
    expect(roundTripped).toEqual(original);
  });

  it('decryptCredentials accepts an optional row_locator and surfaces it on errors', async () => {
    const { decryptCredentials } = await import('@/lib/erp/factory');
    try {
      await decryptCredentials('v2:bad:data', 'erp_configurations/id=abc');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('CRYPTO_BAD_VERSION');
      expect((err as { fields: { row_locator?: string } }).fields.row_locator).toBe('erp_configurations/id=abc');
    }
  });
});
