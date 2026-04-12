import { describe, it, expect } from 'vitest';
import { encryptJson, decryptJson } from '@/lib/crypto/envelope';
import type { CipherProvider } from '@/lib/crypto/provider';

/** A fake CipherProvider that returns predictable bytes so tests don't need node:crypto. */
function makeFakeProvider(keyId = 'fake-v1', transform: (b: Buffer) => Buffer = (b) => b): CipherProvider {
  return {
    encrypt: async (plaintext: Buffer) => ({ keyId, inner: transform(plaintext) }),
    decrypt: async (id: string, inner: Buffer) => {
      if (id !== keyId) throw new Error('wrong key');
      return transform(inner);
    },
  };
}

describe('envelope', () => {
  it('round-trips a plain object via a fake provider', async () => {
    const provider = makeFakeProvider();
    const obj = { access_token: 'at', refresh_token: 'rt', nested: { x: 1 } };
    const envelope = await encryptJson(obj, provider);
    expect(envelope).toMatch(/^v1:fake-v1:/);
    const decrypted = await decryptJson<typeof obj>(envelope, { provider });
    expect(decrypted).toEqual(obj);
  });

  it('envelope matches v1:<keyId>:<base64url> format without padding', async () => {
    const provider = makeFakeProvider('prod-2026q2');
    const envelope = await encryptJson({ x: 1 }, provider);
    expect(envelope).toMatch(/^v1:prod-2026q2:[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain('=');
  });

  it('throws CRYPTO_BAD_ENVELOPE on wrong number of parts', async () => {
    const provider = makeFakeProvider();
    for (const bad of ['', 'v1', 'v1:only', 'v1::data']) {
      await expect(decryptJson(bad, { provider })).rejects.toMatchObject({ code: 'CRYPTO_BAD_ENVELOPE' });
    }
  });

  it('throws CRYPTO_BAD_ENVELOPE on empty trailing data part', async () => {
    const provider = makeFakeProvider();
    await expect(decryptJson('v1:id:', { provider })).rejects.toMatchObject({ code: 'CRYPTO_BAD_ENVELOPE' });
  });

  it('throws CRYPTO_BAD_VERSION for non-v1 version', async () => {
    const provider = makeFakeProvider();
    await expect(decryptJson('v2:fake-v1:aGVsbG8', { provider })).rejects.toMatchObject({
      code: 'CRYPTO_BAD_VERSION',
      fields: expect.objectContaining({ version: 'v2' }),
    });
  });

  it('throws CRYPTO_BAD_ENVELOPE on non-base64url data part', async () => {
    const provider = makeFakeProvider();
    await expect(decryptJson('v1:fake-v1:!!!not-base64!!!', { provider })).rejects.toMatchObject({
      code: 'CRYPTO_BAD_ENVELOPE',
    });
  });

  it('throws CRYPTO_JSON_PARSE_FAIL when decrypted bytes are not valid JSON', async () => {
    const notJsonProvider: CipherProvider = {
      encrypt: async () => ({ keyId: 'v1', inner: Buffer.from([0xff, 0xfe, 0xfd]) }),
      decrypt: async () => Buffer.from([0xff, 0xfe, 0xfd]),
    };
    const envelope = await encryptJson({}, notJsonProvider);
    await expect(decryptJson(envelope, { provider: notJsonProvider })).rejects.toMatchObject({
      code: 'CRYPTO_JSON_PARSE_FAIL',
    });
  });

  it('passes row_locator through into the thrown error', async () => {
    const provider = makeFakeProvider();
    try {
      await decryptJson('v2:fake:aa', { provider, row_locator: 'erp_configurations/id=abc' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('CRYPTO_BAD_VERSION');
      expect((err as { fields: { row_locator?: string } }).fields.row_locator).toBe('erp_configurations/id=abc');
    }
  });

  it('preserves generic typing on decryptJson<T>', async () => {
    const provider = makeFakeProvider();
    interface Thing { a: number; b: string }
    const envelope = await encryptJson<Thing>({ a: 1, b: 'two' }, provider);
    const decrypted = await decryptJson<Thing>(envelope, { provider });
    expect(decrypted.a).toBe(1);
    expect(decrypted.b).toBe('two');
  });
});
