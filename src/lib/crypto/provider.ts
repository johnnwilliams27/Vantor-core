import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  cryptoMissingKey,
  cryptoBadKeyFormat,
  cryptoUnknownKeyId,
  cryptoAuthTagMismatch,
  cryptoBadEnvelope,
  cryptoProviderUnavailable,
} from './errors';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const KEY_ID_RE = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_KEY_ID = 'v1';

export interface EnvKeyConfig {
  primary: { id: string; key: Buffer };
  legacy: Map<string, Buffer>;
}

function validateKeyId(id: string): void {
  if (!KEY_ID_RE.test(id)) {
    throw cryptoBadKeyFormat({ key_id: id, cause: 'key_id must match [A-Za-z0-9_-]+' });
  }
}

function validateAndDecodeHex(hex: string, id: string): Buffer {
  const trimmed = hex.trim();
  if (!HEX64_RE.test(trimmed)) {
    throw cryptoBadKeyFormat({ key_id: id, cause: 'key must be exactly 64 hexadecimal characters' });
  }
  return Buffer.from(trimmed, 'hex');
}

export function loadEnvKeyConfigFromProcessEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): EnvKeyConfig {
  const primaryHex = env.CREDENTIALS_ENCRYPTION_KEY;
  if (primaryHex === undefined || primaryHex === '') {
    throw cryptoMissingKey();
  }

  const primaryId = (env.CREDENTIALS_ENCRYPTION_KEY_ID ?? DEFAULT_KEY_ID).trim();
  validateKeyId(primaryId);

  const primaryKey = validateAndDecodeHex(primaryHex, primaryId);

  const legacy = new Map<string, Buffer>();
  const legacyRaw = env.CREDENTIALS_ENCRYPTION_KEY_LEGACY;
  if (legacyRaw !== undefined && legacyRaw.trim() !== '') {
    const entries = legacyRaw.split(',').map((e) => e.trim()).filter((e) => e.length > 0);
    for (const entry of entries) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx <= 0 || colonIdx === entry.length - 1) {
        throw cryptoBadKeyFormat({
          key_id: entry.slice(0, 12),
          cause: `legacy entry "${entry.slice(0, 20)}..." must be of the form <id>:<hex>`,
        });
      }
      const id = entry.slice(0, colonIdx).trim();
      const hex = entry.slice(colonIdx + 1);
      validateKeyId(id);
      if (id === primaryId) {
        throw cryptoBadKeyFormat({
          key_id: id,
          cause: 'legacy entry duplicates the primary key id',
        });
      }
      if (legacy.has(id)) {
        throw cryptoBadKeyFormat({
          key_id: id,
          cause: 'duplicate legacy key id',
        });
      }
      legacy.set(id, validateAndDecodeHex(hex, id));
    }
  }

  return { primary: { id: primaryId, key: primaryKey }, legacy };
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

export interface CipherProvider {
  encrypt(plaintext: Buffer): Promise<{ keyId: string; inner: Buffer }>;
  decrypt(keyId: string, inner: Buffer): Promise<Buffer>;
}

export class EnvKeyCipherProvider implements CipherProvider {
  private readonly primary: { id: string; key: Buffer };
  private readonly legacy: Map<string, Buffer>;

  constructor(config: EnvKeyConfig) {
    this.primary = config.primary;
    this.legacy = config.legacy;
  }

  private getKeyById(id: string): Buffer {
    if (id === this.primary.id) return this.primary.key;
    const legacyKey = this.legacy.get(id);
    if (!legacyKey) throw cryptoUnknownKeyId({ key_id: id });
    return legacyKey;
  }

  async encrypt(plaintext: Buffer): Promise<{ keyId: string; inner: Buffer }> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.primary.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const inner = Buffer.concat([iv, ct, tag]);
    return { keyId: this.primary.id, inner };
  }

  async decrypt(keyId: string, inner: Buffer): Promise<Buffer> {
    if (inner.length < IV_BYTES + TAG_BYTES) {
      throw cryptoBadEnvelope({ cause: `inner blob too short: ${inner.length} bytes` });
    }
    const key = this.getKeyById(keyId);
    const iv = inner.subarray(0, IV_BYTES);
    const tag = inner.subarray(inner.length - TAG_BYTES);
    const ciphertext = inner.subarray(IV_BYTES, inner.length - TAG_BYTES);

    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw cryptoAuthTagMismatch({ key_id: keyId });
    }
  }
}

let cachedProvider: CipherProvider | null = null;

/**
 * Returns the module-level cached CipherProvider, constructing it on first
 * call. The returned provider is immutable; changing env vars at runtime
 * has no effect until the process restarts (which is always what happens
 * in Vercel production deployments).
 *
 * Test code should NOT use this — construct EnvKeyCipherProvider directly
 * with a config you control, and pass it to encryptJson/decryptJson.
 */
export function getCipherProvider(): CipherProvider {
  // NOTE: errors thrown here are NOT cached — a misconfigured deploy will
  // throw on every call until the env vars are fixed and the process
  // restarts. Only a successful construction is memoized.
  if (cachedProvider) return cachedProvider;
  const providerName = process.env.CRYPTO_PROVIDER ?? 'env';
  if (providerName !== 'env') {
    throw cryptoProviderUnavailable({
      cause: `unknown CRYPTO_PROVIDER value "${providerName}". Valid values: "env". See docs/superpowers/specs/2026-04-11-erp-credentials-encryption-design.md for the KMS migration path.`,
    });
  }
  const config = loadEnvKeyConfigFromProcessEnv(process.env);
  cachedProvider = new EnvKeyCipherProvider(config);
  return cachedProvider;
}

/** Test-only: reset the cached provider so the next call re-reads process.env. */
export function __resetCipherProviderForTests(): void {
  cachedProvider = null;
}
