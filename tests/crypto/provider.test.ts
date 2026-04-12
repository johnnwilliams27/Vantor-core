import { describe, it, expect } from 'vitest';
import { EnvKeyCipherProvider, type EnvKeyConfig } from '@/lib/crypto/provider';

const KEY_A = Buffer.from('a'.repeat(64), 'hex');
const KEY_B = Buffer.from('b'.repeat(64), 'hex');
const KEY_C = Buffer.from('c'.repeat(64), 'hex');

function makeProvider(config: EnvKeyConfig): EnvKeyCipherProvider {
  return new EnvKeyCipherProvider(config);
}

describe('EnvKeyCipherProvider', () => {
  it('round-trips empty plaintext', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const plaintext = Buffer.from('');
    const { keyId, inner } = await provider.encrypt(plaintext);
    expect(keyId).toBe('v1');
    const decrypted = await provider.decrypt(keyId, inner);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('round-trips a small plaintext', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const plaintext = Buffer.from('hello, xero refresh token');
    const { keyId, inner } = await provider.encrypt(plaintext);
    const decrypted = await provider.decrypt(keyId, inner);
    expect(decrypted.toString('utf-8')).toBe('hello, xero refresh token');
  });

  it('round-trips a 10KB plaintext', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const plaintext = Buffer.from('x'.repeat(10_000));
    const { keyId, inner } = await provider.encrypt(plaintext);
    const decrypted = await provider.decrypt(keyId, inner);
    expect(decrypted.length).toBe(10_000);
  });

  it('produces different ciphertexts for the same plaintext (fresh nonce)', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const plaintext = Buffer.from('same input');
    const a = await provider.encrypt(plaintext);
    const b = await provider.encrypt(plaintext);
    expect(a.inner.equals(b.inner)).toBe(false);
  });

  it('uses the primary key id on encrypt', async () => {
    const provider = makeProvider({ primary: { id: 'prod-2026q2', key: KEY_A }, legacy: new Map([['v1', KEY_B]]) });
    const { keyId } = await provider.encrypt(Buffer.from('x'));
    expect(keyId).toBe('prod-2026q2');
  });

  it('decrypts with a legacy key when its id is passed', async () => {
    const oldProvider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const { keyId, inner } = await oldProvider.encrypt(Buffer.from('legacy row'));
    expect(keyId).toBe('v1');

    const newProvider = makeProvider({
      primary: { id: 'v2', key: KEY_B },
      legacy: new Map([['v1', KEY_A]]),
    });
    const decrypted = await newProvider.decrypt('v1', inner);
    expect(decrypted.toString('utf-8')).toBe('legacy row');
  });

  it('throws CRYPTO_UNKNOWN_KEY_ID for an unknown key id', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    await expect(provider.decrypt('notakey', Buffer.alloc(32))).rejects.toMatchObject({
      code: 'CRYPTO_UNKNOWN_KEY_ID',
      fields: expect.objectContaining({ key_id: 'notakey' }),
    });
  });

  it('throws CRYPTO_AUTH_TAG_MISMATCH on tampered inner blob', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const { keyId, inner } = await provider.encrypt(Buffer.from('important'));
    const tampered = Buffer.from(inner);
    tampered[15] ^= 0x01;  // flip one byte in the middle
    await expect(provider.decrypt(keyId, tampered)).rejects.toMatchObject({
      code: 'CRYPTO_AUTH_TAG_MISMATCH',
    });
  });

  it('throws CRYPTO_AUTH_TAG_MISMATCH when the wrong key is used', async () => {
    const providerA = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    const providerWrong = makeProvider({
      primary: { id: 'v2', key: KEY_B },
      legacy: new Map([['v1', KEY_C]]), // same id, different bytes
    });
    const { keyId, inner } = await providerA.encrypt(Buffer.from('x'));
    await expect(providerWrong.decrypt(keyId, inner)).rejects.toMatchObject({
      code: 'CRYPTO_AUTH_TAG_MISMATCH',
    });
  });

  it('throws CRYPTO_BAD_ENVELOPE when inner blob is shorter than iv + tag', async () => {
    const provider = makeProvider({ primary: { id: 'v1', key: KEY_A }, legacy: new Map() });
    await expect(provider.decrypt('v1', Buffer.alloc(10))).rejects.toMatchObject({
      code: 'CRYPTO_BAD_ENVELOPE',
    });
  });
});
