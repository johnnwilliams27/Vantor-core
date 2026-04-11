import { describe, it, expect } from 'vitest';
import { loadEnvKeyConfigFromProcessEnv } from '@/lib/crypto/provider';

const HEX64 = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);
const HEX64_C = 'c'.repeat(64);

describe('loadEnvKeyConfigFromProcessEnv', () => {
  it('throws CRYPTO_MISSING_KEY when primary is missing', () => {
    expect(() => loadEnvKeyConfigFromProcessEnv({})).toThrow(
      expect.objectContaining({ code: 'CRYPTO_MISSING_KEY' }),
    );
  });

  it('parses a minimal primary-only config with default id v1', () => {
    const cfg = loadEnvKeyConfigFromProcessEnv({ CREDENTIALS_ENCRYPTION_KEY: HEX64 });
    expect(cfg.primary.id).toBe('v1');
    expect(cfg.primary.key.length).toBe(32);
    expect(cfg.primary.key.toString('hex')).toBe(HEX64);
    expect(cfg.legacy.size).toBe(0);
  });

  it('respects CREDENTIALS_ENCRYPTION_KEY_ID override', () => {
    const cfg = loadEnvKeyConfigFromProcessEnv({
      CREDENTIALS_ENCRYPTION_KEY: HEX64,
      CREDENTIALS_ENCRYPTION_KEY_ID: 'prod-2026q2',
    });
    expect(cfg.primary.id).toBe('prod-2026q2');
  });

  it('trims whitespace around key values', () => {
    const cfg = loadEnvKeyConfigFromProcessEnv({ CREDENTIALS_ENCRYPTION_KEY: `  ${HEX64}  ` });
    expect(cfg.primary.key.toString('hex')).toBe(HEX64);
  });

  it('throws CRYPTO_BAD_KEY_FORMAT for wrong length key', () => {
    expect(() => loadEnvKeyConfigFromProcessEnv({ CREDENTIALS_ENCRYPTION_KEY: 'abc' })).toThrow(
      expect.objectContaining({ code: 'CRYPTO_BAD_KEY_FORMAT' }),
    );
  });

  it('throws CRYPTO_BAD_KEY_FORMAT for non-hex key', () => {
    expect(() => loadEnvKeyConfigFromProcessEnv({ CREDENTIALS_ENCRYPTION_KEY: 'z'.repeat(64) })).toThrow(
      expect.objectContaining({ code: 'CRYPTO_BAD_KEY_FORMAT' }),
    );
  });

  it('throws CRYPTO_BAD_KEY_FORMAT when primary key id contains a colon', () => {
    expect(() =>
      loadEnvKeyConfigFromProcessEnv({
        CREDENTIALS_ENCRYPTION_KEY: HEX64,
        CREDENTIALS_ENCRYPTION_KEY_ID: 'bad:id',
      }),
    ).toThrow(expect.objectContaining({ code: 'CRYPTO_BAD_KEY_FORMAT' }));
  });

  it('throws CRYPTO_BAD_KEY_FORMAT when primary key id contains whitespace', () => {
    expect(() =>
      loadEnvKeyConfigFromProcessEnv({
        CREDENTIALS_ENCRYPTION_KEY: HEX64,
        CREDENTIALS_ENCRYPTION_KEY_ID: 'bad id',
      }),
    ).toThrow(expect.objectContaining({ code: 'CRYPTO_BAD_KEY_FORMAT' }));
  });

  it('treats empty CREDENTIALS_ENCRYPTION_KEY_LEGACY as no legacy keys', () => {
    const cfg = loadEnvKeyConfigFromProcessEnv({
      CREDENTIALS_ENCRYPTION_KEY: HEX64,
      CREDENTIALS_ENCRYPTION_KEY_LEGACY: '',
    });
    expect(cfg.legacy.size).toBe(0);
  });

  it('parses a single legacy entry', () => {
    const cfg = loadEnvKeyConfigFromProcessEnv({
      CREDENTIALS_ENCRYPTION_KEY: HEX64,
      CREDENTIALS_ENCRYPTION_KEY_LEGACY: `v0:${HEX64_B}`,
    });
    expect(cfg.legacy.size).toBe(1);
    expect(cfg.legacy.get('v0')?.toString('hex')).toBe(HEX64_B);
  });

  it('parses multiple comma-separated legacy entries', () => {
    const cfg = loadEnvKeyConfigFromProcessEnv({
      CREDENTIALS_ENCRYPTION_KEY: HEX64,
      CREDENTIALS_ENCRYPTION_KEY_LEGACY: `v0:${HEX64_B},vA:${HEX64_C}`,
    });
    expect(cfg.legacy.size).toBe(2);
    expect(cfg.legacy.get('v0')?.toString('hex')).toBe(HEX64_B);
    expect(cfg.legacy.get('vA')?.toString('hex')).toBe(HEX64_C);
  });

  it('throws CRYPTO_BAD_KEY_FORMAT for a legacy entry without colon', () => {
    expect(() =>
      loadEnvKeyConfigFromProcessEnv({
        CREDENTIALS_ENCRYPTION_KEY: HEX64,
        CREDENTIALS_ENCRYPTION_KEY_LEGACY: 'noColon',
      }),
    ).toThrow(expect.objectContaining({ code: 'CRYPTO_BAD_KEY_FORMAT' }));
  });

  it('throws CRYPTO_BAD_KEY_FORMAT when a legacy id duplicates the primary id', () => {
    expect(() =>
      loadEnvKeyConfigFromProcessEnv({
        CREDENTIALS_ENCRYPTION_KEY: HEX64,
        CREDENTIALS_ENCRYPTION_KEY_ID: 'v1',
        CREDENTIALS_ENCRYPTION_KEY_LEGACY: `v1:${HEX64_B}`,
      }),
    ).toThrow(expect.objectContaining({ code: 'CRYPTO_BAD_KEY_FORMAT' }));
  });
});
