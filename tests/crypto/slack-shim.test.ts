import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetCipherProviderForTests } from '@/lib/crypto/provider';

const HEX64 = 'a'.repeat(64);

describe('Slack credential shim', () => {
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

  it('encryptSlackCredentials → decryptSlackCredentials round-trips a SlackCredentials object', async () => {
    const { encryptSlackCredentials, decryptSlackCredentials } = await import('@/lib/integrations/slack');
    const original = { botToken: 'xoxb-test-1234', signingSecret: 'ss-abcdef' };
    const envelope = await encryptSlackCredentials(original);
    expect(envelope).toMatch(/^v1:test-v1:/);
    const roundTripped = await decryptSlackCredentials(envelope);
    expect(roundTripped).toEqual(original);
  });

  it('decryptSlackCredentials accepts a row_locator', async () => {
    const { decryptSlackCredentials } = await import('@/lib/integrations/slack');
    try {
      await decryptSlackCredentials('v2:bad:data', 'slack_integrations/user_id=u-42');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('CRYPTO_BAD_VERSION');
      expect((err as { fields: { row_locator?: string } }).fields.row_locator).toBe('slack_integrations/user_id=u-42');
    }
  });
});
