# ERP Credentials Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the base64 passthrough in `encryptCredentials`/`decryptCredentials` and `encryptSlackCredentials`/`decryptSlackCredentials` with real AES-256-GCM encryption via a pluggable `CipherProvider` interface, and wire a fail-loud startup check so the server refuses to boot with a missing or malformed key.

**Architecture:** `src/lib/crypto/` holds three focused files — `errors.ts` (typed `CryptoError` + 8 reason codes), `provider.ts` (`CipherProvider` interface + `EnvKeyCipherProvider` implementation + factory), and `envelope.ts` (`encryptJson` / `decryptJson` that build and parse the `v1:${keyId}:${base64url(...)}` format). Everything outside `src/lib/crypto/` uses the shims in `factory.ts` and `slack.ts`, which delegate to `envelope.ts`. All six existing call sites are already in async contexts and need only a mechanical `await` edit.

**Tech Stack:** TypeScript, Next.js 14.2.29 App Router, `node:crypto` (AES-256-GCM), Vitest, Supabase (for the TRUNCATE migration).

**Spec:** `docs/superpowers/specs/2026-04-11-erp-credentials-encryption-design.md`

**Blocks:** `feature/xero-real-adapter` — the Xero real adapter plan's Phase 0 preflight halts until this lands on master.

**Working directory:** All work happens in the `.worktrees/erp-crypto` worktree on branch `feature/erp-crypto`. Never run `git add` from the main checkout.

---

## Phase 0 — Preflight

### Task 0.1: Verify starting state

**Files:** None (verification only)

- [ ] **Step 1: Confirm you are in the worktree, not the main checkout**

Run: `pwd`
Expected: path contains `.worktrees/erp-crypto`. If not, abort — worktree discipline violation.

- [ ] **Step 2: Confirm branch and clean state**

Run: `git status && git branch --show-current`
Expected: on `feature/erp-crypto`, no uncommitted changes (except maybe `tsconfig.tsbuildinfo` drift).

- [ ] **Step 3: Confirm factory.ts still has the base64 passthrough (so we know we're replacing it, not duplicating work)**

Run: `grep -n "base64/JSON passthrough\\|Buffer.from(encrypted, 'base64')" src/lib/erp/factory.ts`
Expected: matches found. If zero matches, someone has already replaced it — read the file to see the current state before continuing.

- [ ] **Step 4: Confirm vitest version**

Run: `node -p "require('./package.json').devDependencies.vitest"`
Expected: `^2.x`.

- [ ] **Step 5: Confirm `src/instrumentation.ts` exists and wires up Sentry**

Run: `cat src/instrumentation.ts`
Expected: file exists, has `export async function register()` with a `nodejs` runtime branch. This is the file we'll add one line to in Phase 5.

---

## Phase 1 — Crypto module core

### Task 1.1: `errors.ts` — `CryptoError` class + 8 reason codes

**Files:**
- Create: `src/lib/crypto/errors.ts`
- Create: `tests/crypto/errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/crypto/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CryptoError,
  cryptoMissingKey,
  cryptoBadKeyFormat,
  cryptoBadEnvelope,
  cryptoBadVersion,
  cryptoUnknownKeyId,
  cryptoAuthTagMismatch,
  cryptoJsonParseFail,
  cryptoProviderUnavailable,
} from '@/lib/crypto/errors';

describe('CryptoError factory', () => {
  it('cryptoMissingKey sets code, explanation, and next_step', () => {
    const err = cryptoMissingKey();
    expect(err).toBeInstanceOf(CryptoError);
    expect(err.code).toBe('CRYPTO_MISSING_KEY');
    expect(err.next_step).toMatch(/npm run crypto:gen/);
    expect(err.fields.trace_id).toBeDefined();
  });

  it('cryptoBadKeyFormat carries the offending key_id', () => {
    const err = cryptoBadKeyFormat({ key_id: 'legacy-v0' });
    expect(err.code).toBe('CRYPTO_BAD_KEY_FORMAT');
    expect(err.fields.key_id).toBe('legacy-v0');
  });

  it('cryptoBadEnvelope is throwable', () => {
    const err = cryptoBadEnvelope({ row_locator: 'erp_configurations/id=x' });
    expect(err.code).toBe('CRYPTO_BAD_ENVELOPE');
    expect(err.fields.row_locator).toBe('erp_configurations/id=x');
  });

  it('cryptoBadVersion carries the offending version', () => {
    const err = cryptoBadVersion({ version: 'v2' });
    expect(err.code).toBe('CRYPTO_BAD_VERSION');
    expect(err.fields.version).toBe('v2');
  });

  it('cryptoUnknownKeyId carries the unknown key_id', () => {
    const err = cryptoUnknownKeyId({ key_id: 'not-in-registry', row_locator: 'slack_integrations/user=42' });
    expect(err.code).toBe('CRYPTO_UNKNOWN_KEY_ID');
    expect(err.fields.key_id).toBe('not-in-registry');
    expect(err.fields.row_locator).toBe('slack_integrations/user=42');
  });

  it('cryptoAuthTagMismatch carries key_id and row_locator', () => {
    const err = cryptoAuthTagMismatch({ key_id: 'v1', row_locator: 'erp_configurations/id=abc' });
    expect(err.code).toBe('CRYPTO_AUTH_TAG_MISMATCH');
    expect(err.fields.key_id).toBe('v1');
  });

  it('cryptoJsonParseFail is constructible', () => {
    const err = cryptoJsonParseFail({ row_locator: 'x' });
    expect(err.code).toBe('CRYPTO_JSON_PARSE_FAIL');
  });

  it('cryptoProviderUnavailable is constructible', () => {
    const err = cryptoProviderUnavailable({ cause: 'kms timeout' });
    expect(err.code).toBe('CRYPTO_PROVIDER_UNAVAILABLE');
    expect(err.fields.cause).toBe('kms timeout');
  });

  it('toUserFacing exposes only code, next_step, trace_id', () => {
    const err = cryptoAuthTagMismatch({ key_id: 'v1', row_locator: 'erp_configurations/id=abc' });
    const user = err.toUserFacing();
    expect(user).toEqual({
      code: 'CRYPTO_AUTH_TAG_MISMATCH',
      next_step: err.next_step,
      trace_id: err.fields.trace_id,
    });
    expect((user as Record<string, unknown>).key_id).toBeUndefined();
    expect((user as Record<string, unknown>).row_locator).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/errors.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `errors.ts`**

Create `src/lib/crypto/errors.ts`:

```ts
import { randomUUID } from 'node:crypto';

export type CryptoErrorCode =
  | 'CRYPTO_MISSING_KEY'
  | 'CRYPTO_BAD_KEY_FORMAT'
  | 'CRYPTO_BAD_ENVELOPE'
  | 'CRYPTO_BAD_VERSION'
  | 'CRYPTO_UNKNOWN_KEY_ID'
  | 'CRYPTO_AUTH_TAG_MISMATCH'
  | 'CRYPTO_JSON_PARSE_FAIL'
  | 'CRYPTO_PROVIDER_UNAVAILABLE';

export interface CryptoErrorFields {
  trace_id: string;
  row_locator?: string;
  key_id?: string;
  version?: string;
  cause?: string;
  [key: string]: unknown;
}

export interface CryptoUserFacing {
  code: CryptoErrorCode;
  next_step: string;
  trace_id: string;
}

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;
  readonly explanation: string;
  readonly next_step: string;
  readonly fields: CryptoErrorFields;

  constructor(code: CryptoErrorCode, explanation: string, next_step: string, fields: CryptoErrorFields) {
    super(`[${code}] ${explanation}`);
    this.name = 'CryptoError';
    this.code = code;
    this.explanation = explanation;
    this.next_step = next_step;
    this.fields = fields;
  }

  /** Shape safe to return to the UI — no tokens, no row identity, no key ids. */
  toUserFacing(): CryptoUserFacing {
    return {
      code: this.code,
      next_step: this.next_step,
      trace_id: this.fields.trace_id,
    };
  }
}

function withTrace(fields: Omit<CryptoErrorFields, 'trace_id'> = {}): CryptoErrorFields {
  return { trace_id: randomUUID(), ...fields };
}

export function cryptoMissingKey(extra: Partial<CryptoErrorFields> = {}): CryptoError {
  return new CryptoError(
    'CRYPTO_MISSING_KEY',
    'CREDENTIALS_ENCRYPTION_KEY environment variable is not set.',
    'Run `npm run crypto:gen` to create a key and paste it into your .env.local (or your deployment env).',
    withTrace(extra),
  );
}

export function cryptoBadKeyFormat(extra: { key_id?: string; cause?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_BAD_KEY_FORMAT',
    'A credential encryption key is malformed.',
    'Check that every key is exactly 64 hexadecimal characters and that key IDs contain only [A-Za-z0-9_-].',
    withTrace(extra),
  );
}

export function cryptoBadEnvelope(extra: Partial<CryptoErrorFields> = {}): CryptoError {
  return new CryptoError(
    'CRYPTO_BAD_ENVELOPE',
    'An encrypted row is corrupted or malformed.',
    'Mark this integration as unusable and prompt the user to reconnect it. Do not retry.',
    withTrace(extra),
  );
}

export function cryptoBadVersion(extra: { version?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_BAD_VERSION',
    'An encrypted row references an unknown envelope version.',
    'The deployed code does not understand this envelope version. Upgrade the deploy to the latest version.',
    withTrace(extra),
  );
}

export function cryptoUnknownKeyId(extra: { key_id: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_UNKNOWN_KEY_ID',
    'An encrypted row references a key ID that is not loaded in the current key registry.',
    'Add the missing legacy key to CREDENTIALS_ENCRYPTION_KEY_LEGACY, or accept that the row is unreadable and prompt the user to reconnect.',
    withTrace(extra),
  );
}

export function cryptoAuthTagMismatch(extra: { key_id?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_AUTH_TAG_MISMATCH',
    'An encrypted row failed its authentication tag check — either wrong key, tampered ciphertext, or silent data corruption.',
    'Investigate immediately. Mark the integration as corrupted and prompt the user to reconnect.',
    withTrace(extra),
  );
}

export function cryptoJsonParseFail(extra: Partial<CryptoErrorFields> = {}): CryptoError {
  return new CryptoError(
    'CRYPTO_JSON_PARSE_FAIL',
    'Decryption succeeded but the decrypted bytes are not valid JSON.',
    'Mark the integration as corrupted and prompt the user to reconnect. Investigate the writer that produced this row.',
    withTrace(extra),
  );
}

export function cryptoProviderUnavailable(extra: { cause?: string } & Partial<CryptoErrorFields>): CryptoError {
  return new CryptoError(
    'CRYPTO_PROVIDER_UNAVAILABLE',
    'The credential encryption provider is unreachable.',
    'Retry with backoff. If persistent, the upstream key service is down.',
    withTrace(extra),
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/crypto/errors.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/errors.ts tests/crypto/errors.test.ts
git commit -m "feat(crypto): CryptoError factory with 8 reason codes and toUserFacing split"
```

### Task 1.2: `provider.ts` — env config parser (pure function)

**Files:**
- Create: `src/lib/crypto/provider.ts` (partial — config parser only)
- Create: `tests/crypto/env-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/crypto/env-config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/env-config.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the config parser in `provider.ts`**

Create `src/lib/crypto/provider.ts`:

```ts
import { cryptoMissingKey, cryptoBadKeyFormat } from './errors';

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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/crypto/env-config.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/provider.ts tests/crypto/env-config.test.ts
git commit -m "feat(crypto): loadEnvKeyConfigFromProcessEnv pure parser with full validation"
```

### Task 1.3: `provider.ts` — `EnvKeyCipherProvider` class

**Files:**
- Modify: `src/lib/crypto/provider.ts`
- Create: `tests/crypto/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/crypto/provider.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/provider.test.ts`
Expected: FAIL with "EnvKeyCipherProvider is not a constructor" or similar.

- [ ] **Step 3: Append `EnvKeyCipherProvider` to `provider.ts`**

Add to `src/lib/crypto/provider.ts` (append below the existing content from Task 1.2):

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { cryptoUnknownKeyId, cryptoAuthTagMismatch, cryptoBadEnvelope } from './errors';

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
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/crypto/provider.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/provider.ts tests/crypto/provider.test.ts
git commit -m "feat(crypto): EnvKeyCipherProvider with AES-256-GCM encrypt/decrypt and full failure coverage"
```

### Task 1.4: `provider.ts` — `getCipherProvider()` factory

**Files:**
- Modify: `src/lib/crypto/provider.ts`

- [ ] **Step 1: Append the factory to `provider.ts`**

Add to the end of `src/lib/crypto/provider.ts`:

```ts
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
  if (cachedProvider) return cachedProvider;
  const providerName = process.env.CRYPTO_PROVIDER ?? 'env';
  if (providerName !== 'env') {
    throw new Error(
      `CRYPTO_PROVIDER="${providerName}" is not implemented. Valid values: "env". ` +
        'See docs/superpowers/specs/2026-04-11-erp-credentials-encryption-design.md for the KMS migration path.',
    );
  }
  const config = loadEnvKeyConfigFromProcessEnv(process.env);
  cachedProvider = new EnvKeyCipherProvider(config);
  return cachedProvider;
}

/** Test-only: reset the cached provider so the next call re-reads process.env. */
export function __resetCipherProviderForTests(): void {
  cachedProvider = null;
}
```

- [ ] **Step 2: Run existing provider tests to confirm nothing regresses**

Run: `npm test -- --run tests/crypto/provider.test.ts tests/crypto/env-config.test.ts`
Expected: PASS. The factory isn't directly tested here — the shim tests in Task 2.x exercise it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/crypto/provider.ts
git commit -m "feat(crypto): getCipherProvider() factory with module-level cache and CRYPTO_PROVIDER env hook"
```

### Task 1.5: `envelope.ts` — `encryptJson` / `decryptJson` with envelope framing

**Files:**
- Create: `src/lib/crypto/envelope.ts`
- Create: `tests/crypto/envelope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/crypto/envelope.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/envelope.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `envelope.ts`**

Create `src/lib/crypto/envelope.ts`:

```ts
import { getCipherProvider, type CipherProvider } from './provider';
import {
  cryptoBadEnvelope,
  cryptoBadVersion,
  cryptoJsonParseFail,
  CryptoError,
} from './errors';

const VERSION = 'v1';

export interface DecryptOptions {
  row_locator?: string;
  provider?: CipherProvider;
}

export async function encryptJson<T>(obj: T, provider?: CipherProvider): Promise<string> {
  const p = provider ?? getCipherProvider();
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf-8');
  const { keyId, inner } = await p.encrypt(plaintext);
  return `${VERSION}:${keyId}:${inner.toString('base64url')}`;
}

export async function decryptJson<T>(envelope: string, opts: DecryptOptions = {}): Promise<T> {
  const { row_locator, provider } = opts;
  const p = provider ?? getCipherProvider();

  // Parse envelope: must have exactly three non-empty parts.
  const parts = envelope.split(':');
  if (parts.length !== 3 || parts[0].length === 0 || parts[1].length === 0 || parts[2].length === 0) {
    throw cryptoBadEnvelope({ row_locator, cause: 'envelope must be of the form v1:<keyId>:<base64url>' });
  }
  const [version, keyId, data] = parts;

  if (version !== VERSION) {
    throw cryptoBadVersion({ version, row_locator });
  }

  let inner: Buffer;
  try {
    inner = Buffer.from(data, 'base64url');
    // Buffer.from with base64url silently drops invalid chars rather than throwing.
    // Round-trip to detect: if encoding back produces a different string, input was invalid.
    if (inner.toString('base64url') !== data) {
      throw new Error('invalid base64url');
    }
  } catch {
    throw cryptoBadEnvelope({ row_locator, cause: 'data part is not valid base64url' });
  }

  // Length validation is the provider's responsibility — the envelope layer
  // is algorithm-agnostic. The env provider enforces IV + tag minimums; a
  // future KMS provider would enforce its own bounds.

  let plaintext: Buffer;
  try {
    plaintext = await p.decrypt(keyId, inner);
  } catch (err) {
    // Re-throw CryptoErrors after attaching row_locator; wrap anything else as upstream.
    if (err instanceof CryptoError) {
      if (row_locator && !err.fields.row_locator) {
        err.fields.row_locator = row_locator;
      }
      throw err;
    }
    throw err;
  }

  try {
    return JSON.parse(plaintext.toString('utf-8')) as T;
  } catch {
    throw cryptoJsonParseFail({ row_locator });
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/crypto/envelope.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the full crypto test suite to confirm integration**

Run: `npm test -- --run tests/crypto/`
Expected: PASS (all tests from Tasks 1.1-1.5 — 41 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/lib/crypto/envelope.ts tests/crypto/envelope.test.ts
git commit -m "feat(crypto): envelope.ts with encryptJson/decryptJson and row_locator plumbing"
```

---

## Phase 2 — Shim rewrites

### Task 2.1: Replace `encryptCredentials` / `decryptCredentials` in `factory.ts`

**Files:**
- Modify: `src/lib/erp/factory.ts`
- Create: `tests/crypto/erp-shim.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/crypto/erp-shim.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/erp-shim.test.ts`
Expected: FAIL because `encryptCredentials` is still synchronous and returns a base64 string.

- [ ] **Step 3: Rewrite the shim in `factory.ts`**

Replace lines 36-51 of `src/lib/erp/factory.ts` with:

```ts
import { encryptJson, decryptJson } from '@/lib/crypto/envelope';

/**
 * Encrypt ERP credentials for storage in erp_configurations.credentials.
 * Uses AES-256-GCM via the CipherProvider abstraction.
 */
export async function encryptCredentials(credentials: ERPCredentials): Promise<string> {
  return encryptJson(credentials);
}

/**
 * Decrypt ERP credentials from erp_configurations.credentials.
 *
 * @param encrypted - the envelope string stored in the DB
 * @param row_locator - optional caller-provided identifier (e.g. "erp_configurations/id=abc-123")
 *                      that is attached to any CryptoError thrown during decryption so logs
 *                      identify the failing row.
 */
export async function decryptCredentials(encrypted: string, row_locator?: string): Promise<ERPCredentials> {
  return decryptJson<ERPCredentials>(encrypted, { row_locator });
}
```

- [ ] **Step 4: Run the test to confirm the shim works**

Run: `npm test -- --run tests/crypto/erp-shim.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Type-check the repo to find broken call sites**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: errors in `src/app/api/erp/connect/route.ts`, `src/app/api/erp/gl-post/route.ts`, `src/app/api/cron/sync-erp/route.ts`, `src/app/api/invoices/sync/route.ts`, and `src/lib/agent/tools.ts`. Each error says the sync call returns `Promise<...>` but is used as though synchronous.

- [ ] **Step 6: Do not commit yet**

Task 2.2 updates all five call sites; commit together.

### Task 2.2: Add `await` to the five ERP call sites

**Files:**
- Modify: `src/app/api/erp/connect/route.ts`
- Modify: `src/app/api/erp/gl-post/route.ts` (if still present; Xero plan deletes it — skip if missing)
- Modify: `src/app/api/cron/sync-erp/route.ts`
- Modify: `src/app/api/invoices/sync/route.ts`
- Modify: `src/lib/agent/tools.ts`

- [ ] **Step 1: Update `src/app/api/erp/connect/route.ts`**

Find the line at approximately 55:
```ts
  const encrypted = encryptCredentials(credentials);
```
Replace with:
```ts
  const encrypted = await encryptCredentials(credentials);
```

Also check for any `decryptCredentials(...)` call and add `await` the same way. Pass a `row_locator` if the surrounding code has a row ID available; if not, leave it off.

- [ ] **Step 2: Update `src/app/api/erp/gl-post/route.ts` (conditional)**

Run: `test -f src/app/api/erp/gl-post/route.ts && echo exists || echo gone`

If `exists`: find line ~45:
```ts
  const credentials = decryptCredentials(erpConfig.credentials);
```
Replace with:
```ts
  const credentials = await decryptCredentials(erpConfig.credentials, `erp_configurations/id=${erpConfig.id}`);
```

If `gone`: the Xero plan has already merged and deleted this file. Skip.

- [ ] **Step 3: Update `src/app/api/cron/sync-erp/route.ts`**

Find line ~47:
```ts
      const credentials = decryptCredentials(erpConfig.credentials);
```
Replace with:
```ts
      const credentials = await decryptCredentials(erpConfig.credentials, `erp_configurations/id=${erpConfig.id}`);
```

- [ ] **Step 4: Update `src/app/api/invoices/sync/route.ts`**

Find line ~45:
```ts
  const credentials = decryptCredentials(erpConfig.credentials);
```
Replace with:
```ts
  const credentials = await decryptCredentials(erpConfig.credentials, `erp_configurations/id=${erpConfig.id}`);
```

- [ ] **Step 5: Update `src/lib/agent/tools.ts`**

Find line ~267:
```ts
    const creds = decryptCredentials(config.credentials_enc as string);
```

This line is the pre-existing bug (reads `credentials_enc` instead of `credentials` — documented in the spec's Future Work). **Do not fix the column name in this slice.** Only add `await`:

```ts
    const creds = await decryptCredentials(config.credentials_enc as string, `erp_configurations/id=${config.id}`);
```

The broken column read remains — it's out of scope.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: clean. If anything remains, it's a call site I missed — find it and add `await`.

- [ ] **Step 7: Run the full test suite**

Run: `npm test -- --run`
Expected: PASS. The existing tests don't directly exercise these call sites, but the compile must be clean and nothing should regress.

- [ ] **Step 8: Commit Phase 2 as one unit**

```bash
git add src/lib/erp/factory.ts tests/crypto/erp-shim.test.ts \
        src/app/api/erp/connect/route.ts \
        src/app/api/cron/sync-erp/route.ts \
        src/app/api/invoices/sync/route.ts \
        src/lib/agent/tools.ts
# Only add gl-post/route.ts if it still exists (Xero plan may have removed it):
test -f src/app/api/erp/gl-post/route.ts && git add src/app/api/erp/gl-post/route.ts

git commit -m "$(cat <<'EOF'
refactor(erp): replace base64 passthrough with AES-256-GCM via envelope helper

encryptCredentials / decryptCredentials now delegate to encryptJson /
decryptJson in src/lib/crypto/envelope. Both become async; the five
existing call sites add await and a row_locator for error plumbing.

The pre-existing 'credentials_enc' column-name bug in src/lib/agent/tools.ts
is intentionally left unfixed — out of scope for this slice, see the
spec's Future Work section.
EOF
)"
```

### Task 2.3: Replace Slack shim and update its 5 call sites

**Files:**
- Modify: `src/lib/integrations/slack.ts`
- Modify: `src/app/api/integrations/slack/route.ts`
- Modify: `src/app/api/integrations/slack/callback/route.ts`
- Modify: `src/app/api/integrations/slack/test/route.ts`
- Modify: `src/app/api/cron/treasury-analysis/route.ts`
- Modify: `src/app/api/treasury/recommendations/generate/route.ts`
- Create: `tests/crypto/slack-shim.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/crypto/slack-shim.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/slack-shim.test.ts`
Expected: FAIL — functions are still sync.

- [ ] **Step 3: Rewrite the shim in `src/lib/integrations/slack.ts`**

Replace lines 22-35 (the `Encryption` section) with:

```ts
// ---- Encryption (delegates to src/lib/crypto/envelope) ----

import { encryptJson, decryptJson } from '@/lib/crypto/envelope';

export async function encryptSlackCredentials(creds: SlackCredentials): Promise<string> {
  return encryptJson(creds);
}

export async function decryptSlackCredentials(encrypted: string, row_locator?: string): Promise<SlackCredentials> {
  return decryptJson<SlackCredentials>(encrypted, { row_locator });
}
```

- [ ] **Step 4: Run the shim test to confirm it passes**

Run: `npm test -- --run tests/crypto/slack-shim.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check to find broken Slack call sites**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: errors at the 5 Slack call sites identified earlier.

- [ ] **Step 6: Update `src/app/api/integrations/slack/route.ts`**

Find line ~53:
```ts
  const encrypted = encryptSlackCredentials({ botToken, signingSecret });
```
Replace with:
```ts
  const encrypted = await encryptSlackCredentials({ botToken, signingSecret });
```

- [ ] **Step 7: Update `src/app/api/integrations/slack/callback/route.ts`**

Find line ~84:
```ts
    creds = decryptSlackCredentials(integration.credentials);
```
Replace with:
```ts
    creds = await decryptSlackCredentials(integration.credentials, `slack_integrations/id=${integration.id}`);
```

- [ ] **Step 8: Update `src/app/api/integrations/slack/test/route.ts`**

Find line ~32:
```ts
    creds = decryptSlackCredentials(integration.credentials);
```
Replace with:
```ts
    creds = await decryptSlackCredentials(integration.credentials, `slack_integrations/id=${integration.id}`);
```

- [ ] **Step 9: Update `src/app/api/cron/treasury-analysis/route.ts`**

Find line ~176:
```ts
        const creds = decryptSlackCredentials(slackIntegration.credentials);
```
Replace with:
```ts
        const creds = await decryptSlackCredentials(slackIntegration.credentials, `slack_integrations/id=${slackIntegration.id}`);
```

- [ ] **Step 10: Update `src/app/api/treasury/recommendations/generate/route.ts`**

Find line ~99:
```ts
          const creds = decryptSlackCredentials(slackIntegration.credentials);
```
Replace with:
```ts
          const creds = await decryptSlackCredentials(slackIntegration.credentials, `slack_integrations/id=${slackIntegration.id}`);
```

- [ ] **Step 11: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 12: Run the full test suite**

Run: `npm test -- --run`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/lib/integrations/slack.ts tests/crypto/slack-shim.test.ts \
        src/app/api/integrations/slack/route.ts \
        src/app/api/integrations/slack/callback/route.ts \
        src/app/api/integrations/slack/test/route.ts \
        src/app/api/cron/treasury-analysis/route.ts \
        src/app/api/treasury/recommendations/generate/route.ts
git commit -m "refactor(slack): delegate credential encryption to src/lib/crypto/envelope"
```

---

## Phase 3 — Startup check, generator script, docs

### Task 3.1: Add the startup check to `src/instrumentation.ts`

**Files:**
- Modify: `src/instrumentation.ts`
- Create: `tests/crypto/startup.test.ts`

- [ ] **Step 1: Write the failing startup test**

Create `tests/crypto/startup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/crypto/startup.test.ts`
Expected: FAIL. The first test fails because `register()` never imports crypto; the second fails for the same reason.

- [ ] **Step 3: Update `src/instrumentation.ts`**

Replace the file with:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    // Fail loud on bad crypto config BEFORE handling requests.
    // This exercises the full provider + envelope path with a throwaway plaintext.
    const { encryptJson } = await import('./lib/crypto/envelope');
    await encryptJson({ startup_check: true });
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/crypto/startup.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/instrumentation.ts tests/crypto/startup.test.ts
git commit -m "feat(crypto): fail-loud startup check in src/instrumentation.ts register()"
```

### Task 3.2: Create the key generator script and `npm run crypto:gen`

**Files:**
- Create: `scripts/gen-encryption-key.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the generator script**

Create `scripts/gen-encryption-key.ts`:

```ts
#!/usr/bin/env node
/**
 * One-shot generator for CREDENTIALS_ENCRYPTION_KEY.
 * Prints two lines suitable for pasting into .env.local.
 *
 * Usage: npm run crypto:gen
 */
import { randomBytes } from 'node:crypto';

const key = randomBytes(32).toString('hex');

process.stdout.write(`CREDENTIALS_ENCRYPTION_KEY=${key}\n`);
process.stdout.write(`CREDENTIALS_ENCRYPTION_KEY_ID=v1\n`);
process.stdout.write('\n');
process.stdout.write('Copy the two lines above into your .env.local.\n');
process.stdout.write('Never commit this key. Never share it over insecure channels.\n');
```

- [ ] **Step 2: Check if `tsx` is installed**

Run: `node -p "require('./package.json').devDependencies.tsx || require('./package.json').dependencies.tsx || 'not installed'"`

- [ ] **Step 3: Install `tsx` if not present**

If the previous step printed `not installed`, run: `npm install --save-dev tsx`

Otherwise skip.

- [ ] **Step 4: Add the `crypto:gen` script to `package.json`**

Edit `package.json`, add to the `scripts` object:

```json
"crypto:gen": "tsx scripts/gen-encryption-key.ts"
```

- [ ] **Step 5: Smoke-test the script**

Run: `npm run crypto:gen`
Expected: prints two env var lines where the key is a 64-char hex string, followed by usage instructions.

Verify the hex format: run `npm run crypto:gen | head -1 | sed 's/CREDENTIALS_ENCRYPTION_KEY=//' | grep -cE '^[0-9a-f]{64}$'`
Expected: `1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-encryption-key.ts package.json package-lock.json
git commit -m "chore(crypto): npm run crypto:gen generator for CREDENTIALS_ENCRYPTION_KEY"
```

### Task 3.3: Update `.env.local.example`

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Read the current state around the encryption key line**

Run: `grep -n -B1 -A2 "CREDENTIALS_ENCRYPTION_KEY" .env.local.example`
Expected: a single line matching `CREDENTIALS_ENCRYPTION_KEY=your-32-byte-hex-key` (from line 64 as found during spec research).

- [ ] **Step 2: Replace the line with the updated template**

Find the line:
```
CREDENTIALS_ENCRYPTION_KEY=your-32-byte-hex-key
```

Replace with:
```
# ERP + Slack credential encryption. Required — the server will refuse to
# boot without this. Generate a new key with: npm run crypto:gen
CREDENTIALS_ENCRYPTION_KEY=
CREDENTIALS_ENCRYPTION_KEY_ID=v1
# Optional: comma-separated id:hex pairs of retired keys kept around so
# previously-written rows can still be decrypted while rotating.
# CREDENTIALS_ENCRYPTION_KEY_LEGACY=v0:0123456789abcdef...
```

- [ ] **Step 3: Commit**

```bash
git add .env.local.example
git commit -m "docs(crypto): update .env.local.example with generator pointer and legacy-key hint"
```

### Task 3.4: Generate and set the local dev key

**Files:** None (local env only — `.env.local` is gitignored)

- [ ] **Step 1: Generate a key**

Run: `npm run crypto:gen`

Copy the two printed lines.

- [ ] **Step 2: Paste into `.env.local`**

Open `.env.local`. If `CREDENTIALS_ENCRYPTION_KEY` already has a placeholder value, replace it with the new key. Otherwise append the two lines.

- [ ] **Step 3: Verify the dev server can start**

Run: `npm run dev`
Expected: starts without throwing a `CryptoError`. Hit Ctrl-C to stop after confirming it's up.

- [ ] **Step 4: Verify the startup check fires when the key is missing**

Temporarily rename the env var in `.env.local` (e.g., change `CREDENTIALS_ENCRYPTION_KEY` to `CREDENTIALS_ENCRYPTION_KEY_DISABLED_TEST`) and run `npm run dev` again.

Expected: the server fails to start with a clear error mentioning `CRYPTO_MISSING_KEY` and `npm run crypto:gen` in the next_step.

- [ ] **Step 5: Restore the env var**

Rename back to `CREDENTIALS_ENCRYPTION_KEY` and confirm the dev server starts again.

- [ ] **Step 6: Do not commit**

`.env.local` is gitignored — there's nothing to commit in this step. This is a manual smoke test only.

---

## Phase 4 — Supabase migration: TRUNCATE dummy rows

### Task 4.1: Write the TRUNCATE migration

**Files:**
- Create: `supabase/migrations/0038_truncate_dummy_credentials.sql`

(Note: If the Xero plan has already merged, it will have taken the `0038_xero_adapter.sql` slot. In that case, bump the number to the next available slot, e.g., `0039_truncate_dummy_credentials.sql`. Check with `ls supabase/migrations/ | tail -5`.)

- [ ] **Step 1: Confirm the next migration number**

Run: `ls supabase/migrations/ | tail -5`
Record the highest number. Use the next number for this migration file.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<NNNN>_truncate_dummy_credentials.sql`:

```sql
-- NNNN_truncate_dummy_credentials.sql
-- Empties dummy-data rows from erp_configurations and slack_integrations
-- as part of the switch from base64 passthrough to real AES-256-GCM.
--
-- SAFETY: this is destructive. The plan that applies this migration runs
-- a SELECT COUNT(*) in BOTH tables, in BOTH dev and prod, before applying
-- it. If either table contains more than a trivial number of rows, STOP
-- and investigate — the base64-encoded credentials cannot be decrypted by
-- the new code, so they must be re-entered by the user anyway, but you
-- must confirm with the product owner that losing them is acceptable.

TRUNCATE TABLE erp_configurations CASCADE;
TRUNCATE TABLE slack_integrations CASCADE;
```

- [ ] **Step 3: Commit (migration file only — not yet applied)**

```bash
git add supabase/migrations/<NNNN>_truncate_dummy_credentials.sql
git commit -m "feat(db): migration to truncate dummy ERP + Slack credential rows before cutover"
```

### Task 4.2: Verify and apply the migration to dev Supabase

**Files:** None (remote DB operation)

- [ ] **Step 1: Count rows in dev before applying**

Run a read-only query against dev via your usual Supabase access method. Either:
- Use the Supabase dashboard SQL editor for project `spllxotyxipdvfpkkvgu`, OR
- Use the team's `supabase` CLI if configured.

```sql
SELECT 'erp_configurations' AS table, COUNT(*) AS rows FROM erp_configurations
UNION ALL
SELECT 'slack_integrations', COUNT(*) FROM slack_integrations;
```

Expected: both counts small (single digits or zero). If either is unexpectedly large, **stop** and investigate before proceeding.

- [ ] **Step 2: Apply the migration to dev**

Use the team's standard migration workflow. If it's manual:

```bash
npx supabase db push --db-url "$DEV_SUPABASE_URL"
```

Otherwise use whatever script the team uses (`npm run db:migrate:dev` or similar).

Expected: migration applies without error.

- [ ] **Step 3: Verify dev tables are empty**

Re-run the count query from Step 1 against dev.
Expected: both counts are `0`.

### Task 4.3: Verify and apply the migration to prod Supabase

**Files:** None (remote DB operation)

- [ ] **Step 1: Count rows in prod before applying**

Run the same count query against the prod project (`lfujbwemavgiifkltrag`). **Before applying**, confirm with the product owner that the count is acceptable to lose.

Expected: both counts small or zero.

- [ ] **Step 2: Apply the migration to prod**

Use the standard prod migration workflow.

Expected: migration applies without error.

- [ ] **Step 3: Verify prod tables are empty**

Re-run the count query. Expected: both counts are `0`.

- [ ] **Step 4: Confirm CREDENTIALS_ENCRYPTION_KEY is set on Vercel prod**

In Vercel, navigate to Project Settings → Environment Variables → Production. Confirm `CREDENTIALS_ENCRYPTION_KEY` is set to a valid 64-char hex string, `CREDENTIALS_ENCRYPTION_KEY_ID` is set to `v1` (or an equivalent), and `CREDENTIALS_ENCRYPTION_KEY_LEGACY` is either unset or empty.

If `CREDENTIALS_ENCRYPTION_KEY` is unset on Vercel prod, **stop** — the next deploy will fail its startup check and take the site down. Generate a key with `npm run crypto:gen`, set it in Vercel, redeploy, and only then merge this plan's branch.

---

## Phase 5 — Final verification + PR

### Task 5.1: Full test run + build

**Files:** None (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test -- --run`
Expected: all tests pass, including the new crypto suites (~45+ tests total across Phase 1-3).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean Next.js production build. The build process does not run `instrumentation.ts`, so this will not catch a missing `CREDENTIALS_ENCRYPTION_KEY` — that's what the dev-server smoke test is for.

### Task 5.2: Manual smoke test on dev

**Files:** None

- [ ] **Step 1: Ensure `CREDENTIALS_ENCRYPTION_KEY` is set in `.env.local`**

If you already completed Task 3.4, this is done. If not, run `npm run crypto:gen` and paste the output into `.env.local`.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: starts cleanly. Watch the terminal for any `[CRYPTO_*]` errors in the first 10 seconds.

- [ ] **Step 3: Walk through an ERP mock connect**

Log into Vantor locally, navigate to `/settings/erp`, connect any ERP provider (the mocks will accept anything). Confirm the connect flow completes without error and a row appears in `erp_configurations`.

Inspect the `credentials` column of the newly-written row via the dev Supabase dashboard. It should start with `v1:v1:` (or whatever primary key ID you used) and be significantly longer than a base64-encoded JSON blob would be.

- [ ] **Step 4: Trigger a read path**

Do whatever existing flow reads `erp_configurations` — e.g., trigger an ERP sync via the UI. Confirm it succeeds, which proves `decryptCredentials` round-trips correctly through the new helper.

- [ ] **Step 5: Walk through a Slack connect**

Do the same for the Slack integration at `/settings/integrations` (or wherever it lives). Connect, verify the row lands with a `v1:...` credential, trigger a path that decrypts (e.g., `/api/integrations/slack/test`), confirm success.

- [ ] **Step 6: Kill the dev server**

Ctrl-C.

### Task 5.3: Push and open PR

**Files:** None (git commands only)

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feature/erp-crypto`

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "feat(crypto): AES-256-GCM encryption for ERP + Slack credentials" --body "$(cat <<'EOF'
## Summary

- Replaces base64 passthrough in `encryptCredentials` / `decryptCredentials` (ERP) and `encryptSlackCredentials` / `decryptSlackCredentials` with real AES-256-GCM via a new `src/lib/crypto/` module
- Pluggable `CipherProvider` interface (env-var-held keys today; future KMS provider is a one-file migration)
- Envelope format `v1:${keyId}:${base64url(iv || ciphertext || authTag)}` — version byte + key ID enable drop-in key rotation
- Fail-loud startup check in `src/instrumentation.ts` — server refuses to boot with missing or malformed key
- `npm run crypto:gen` generator for local dev key material
- Supabase migration TRUNCATEs dummy rows in `erp_configurations` and `slack_integrations` on cutover (applied to dev + prod)
- Six existing call sites mechanically updated with `await` (all were already in async contexts)

## Unblocks

`feature/xero-real-adapter` — Xero plan Phase 0 preflight halts until real encryption lands on master.

## Test plan

- [ ] `npm test` green (crypto unit tests, shim integration tests, startup test — ~45 tests across `tests/crypto/`)
- [ ] `npm run build` clean
- [ ] Manual smoke on dev server: startup fails loud with missing key; starts clean with valid key; ERP connect + Slack connect both round-trip through the new helper
- [ ] Vercel prod `CREDENTIALS_ENCRYPTION_KEY` verified before merge

Spec: `docs/superpowers/specs/2026-04-11-erp-credentials-encryption-design.md`
Plan: `docs/superpowers/plans/2026-04-11-erp-credentials-encryption.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Post the PR URL back for review**

---

## Appendix A — Spec coverage map

| Spec section | Task |
|---|---|
| §Hard deliverables #1 (`src/lib/crypto/` module) | 1.1, 1.2, 1.3, 1.4, 1.5 |
| §Hard deliverables #2 (shim rewrites) | 2.1, 2.3 |
| §Hard deliverables #3 (`instrumentation.ts`) | 3.1 |
| §Hard deliverables #4 (generator script) | 3.2 |
| §Hard deliverables #5 (`.env.local.example`) | 3.3 |
| §Hard deliverables #6 (TRUNCATE migration) | 4.1, 4.2, 4.3 |
| §Hard deliverables #7 (test coverage) | 1.1-1.5 (unit), 2.1, 2.3 (shim integration), 3.1 (startup) |
| §Components — `errors.ts` | 1.1 |
| §Components — `provider.ts` interface + env impl | 1.2, 1.3, 1.4 |
| §Components — `envelope.ts` | 1.5 |
| §Components — `factory.ts` shim | 2.1 |
| §Components — `slack.ts` shim | 2.3 |
| §Components — six `await` call sites (ERP 5, Slack 5; ERP's gl-post may be gone) | 2.2, 2.3 |
| §Components — `gen-encryption-key.ts` + `npm run crypto:gen` | 3.2 |
| §Components — `.env.local.example` | 3.3 |
| §Components — TRUNCATE migration (dev + prod) | 4.1, 4.2, 4.3 |
| §Components — `src/instrumentation.ts` | 3.1 |
| §Envelope format | 1.3 (inner), 1.5 (envelope framing) |
| §Data flow — Encrypt | 1.3, 1.5 |
| §Data flow — Decrypt | 1.3, 1.5 |
| §Data flow — Key registry parsing | 1.2 |
| §Error handling — 8 reason codes | 1.1 |
| §Error handling — `toUserFacing` split | 1.1 |
| §Error handling — Caller contract | Documented in spec; callers adopt via future work (Xero adapter) |
| §Testing — Layer 1 unit | 1.1, 1.2, 1.3, 1.5 |
| §Testing — Layer 2 shim integration | 2.1, 2.3 |
| §Testing — Layer 3 startup check | 3.1 |
| §Testing — Manual cutover smoke | 5.2 |
| §Future work — KMS provider | Not in this plan (spec §Future work) |
| §Future work — Rotation cleanup script | Not in this plan |
| §Future work — AAD | Not in this plan |
| §Future work — `agent/tools.ts credentials_enc` bug | Not in this plan (explicitly left unfixed in Task 2.2 Step 5) |
| §Future work — Caller error-code pattern matching | Not in this plan |
