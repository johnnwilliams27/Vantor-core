# ERP Credentials Encryption — Design Spec

**Date:** 2026-04-11
**Status:** Proposed
**Branch:** `feature/erp-crypto`
**Blocks:** `feature/xero-real-adapter` — the Xero real adapter plan (`docs/superpowers/plans/2026-04-11-xero-real-adapter.md`) cannot proceed until this ships. Xero refresh tokens must not be stored as base64-encoded plaintext.

## Goal

Replace the base64 passthrough in `src/lib/erp/factory.ts::encryptCredentials` / `decryptCredentials` and `src/lib/integrations/slack.ts::encryptSlackCredentials` / `decryptSlackCredentials` with real authenticated encryption (AES-256-GCM) keyed by a credentials-encryption-key environment variable, using a pluggable provider interface so the eventual migration to a managed KMS (AWS KMS / GCP KMS / HashiCorp Vault) is a one-file change. Build the envelope format from day one to carry a version byte and a key ID so future rotations and provider migrations are non-events.

This is a security-relevant change that affects how both ERP and Slack credentials are stored at rest. Today, anyone with database read access can one-line base64-decode any stored credential. After this slice, credentials are encrypted under a 32-byte key that never lands in the database.

## Non-goals

- Managed KMS integration (AWS KMS / GCP KMS / Vault transit). The `CipherProvider` interface is designed so this is additive later, but no KMS implementation ships in this slice. See §Future work.
- Background re-encryption script for rotating keys in bulk. The envelope format supports rotation without a migration, so a background re-encrypt is nice-to-have but not needed to roll keys. Deferred until first rotation.
- Key-encryption-key (KEK) + data-encryption-key (DEK) envelope encryption à la AWS Encryption SDK. Overkill for Vantor's current scale — one key per environment, one row per credential.
- HSM-backed keys. The key lives in an environment variable; its security boundary is whoever can read Vercel env vars and backups.
- Additional Authenticated Data (AAD) binding row/table identity into the auth tag. Defends against ciphertext-swap attacks from an attacker with database write access, but anyone with DB write access has already bypassed this layer. Adds churn to every call site. Not in this slice.
- Encrypting at-rest fields other than ERP and Slack credentials. No other fields today require this treatment.
- Migrating any existing base64 ciphertexts. There are no real rows to migrate — the dev and prod `erp_configurations` and `slack_integrations` tables contain dummy data only. Cutover TRUNCATEs them.
- Fixing the unrelated pre-existing bug in `src/lib/agent/tools.ts:267` where it reads `config.credentials_enc` instead of `config.credentials`. Out of scope.
- Deleting `src/app/api/erp/gl-post/route.ts`. That's the Xero plan's responsibility; if the Xero plan lands first that file is gone, otherwise this plan leaves it untouched.

## Approach

Build a small `src/lib/crypto/` module whose public API is `encryptJson<T>(obj: T): Promise<string>` and `decryptJson<T>(envelope: string, opts?: { row_locator?: string }): Promise<T>`. These functions delegate to a `CipherProvider` implementation chosen via `getCipherProvider()`. The initial implementation, `EnvKeyCipherProvider`, holds a 32-byte key loaded from `CREDENTIALS_ENCRYPTION_KEY` and performs AES-256-GCM via `node:crypto::createCipheriv`. A future `KmsCipherProvider` is a new file implementing the same interface and chosen via the `CRYPTO_PROVIDER` environment variable — no changes to `envelope.ts`, the shims, or any caller.

The ERP and Slack credential helpers become thin async shims over `encryptJson` / `decryptJson`. All six existing call sites continue to work with a mechanical sync-to-async signature change (they're all in async contexts already).

The envelope format is `v1:${keyId}:${base64url(iv || ciphertext || authTag)}` — a version byte and a key ID carry the metadata needed for both rotation (different key IDs for current and legacy keys) and future format migration (different version when we eventually swap AEAD or framing). Rotation is a drop-in env-var change with no migration script.

A startup check in the existing `src/instrumentation.ts::register()` runs a round-trip encrypt of a constant string as soon as the `nodejs` runtime initializes, so a misconfigured key fails the server's boot rather than surfacing at first request.

## Hard deliverables

1. `src/lib/crypto/` module with provider interface + env-key implementation + envelope framing + error factory.
2. `src/lib/erp/factory.ts` and `src/lib/integrations/slack.ts` shim rewrites.
3. `src/instrumentation.ts` startup-check wire-up.
4. `scripts/gen-encryption-key.ts` random-key generator + `npm run crypto:gen` script.
5. `.env.local.example` updated with the generator pointer and required variables.
6. Supabase migration that TRUNCATEs the dummy `erp_configurations` and `slack_integrations` rows in both dev and prod.
7. Test coverage across three layers (see §Testing).

## Components

### New: `src/lib/crypto/`

**`src/lib/crypto/errors.ts`** — `CryptoError` class and factory per reason code. Eight reason codes total; see §Error handling for the complete list. One constructor per code, structured fields, `toUserFacing()` serializer that exposes only `code`, `next_step`, and `trace_id`. ~80 LOC.

**`src/lib/crypto/provider.ts`** — Defines `CipherProvider` interface:

```ts
export interface CipherProvider {
  /**
   * Encrypt plaintext with the provider's current primary key. Returns the
   * key ID the envelope layer should include, plus opaque inner bytes whose
   * format is provider-specific (for env provider: iv || ciphertext || authTag).
   */
  encrypt(plaintext: Buffer): Promise<{ keyId: string; inner: Buffer }>;

  /** Decrypt inner bytes using the key identified by keyId. */
  decrypt(keyId: string, inner: Buffer): Promise<Buffer>;
}
```

Ships one implementation, `EnvKeyCipherProvider`, which holds a primary key Buffer and a legacy-keys Map keyed by string ID. Encrypt/decrypt implemented via `createCipheriv('aes-256-gcm', ...)` with random 12-byte IVs and 16-byte auth tags. The file also exports `loadEnvKeyConfigFromProcessEnv(env)` — a pure function that parses a `NodeJS.ProcessEnv`-shaped object into `{ primary: { id, key }, legacy: Map<id, key> }` so tests can drive config construction without mutating `process.env`. ~150 LOC total.

The file also exports a module-level cached `getCipherProvider(): CipherProvider` factory that reads `process.env.CRYPTO_PROVIDER` (default `'env'`), constructs the appropriate provider, caches the result, and returns it on subsequent calls. Future providers register here.

**`src/lib/crypto/envelope.ts`** — The high-level public API. Two functions:

```ts
export async function encryptJson<T>(obj: T, provider?: CipherProvider): Promise<string>;
export async function decryptJson<T>(
  envelope: string,
  opts?: { row_locator?: string; provider?: CipherProvider },
): Promise<T>;
```

`encryptJson` JSON-stringifies the object, calls `provider.encrypt(plaintext)`, and returns `v1:${keyId}:${base64url(inner)}`. `decryptJson` parses the envelope, validates version and structure, looks up the provider's key via `provider.decrypt(keyId, inner)`, JSON-parses the result. The `provider` parameter defaults to `getCipherProvider()` when omitted; tests pass their own. `row_locator` plumbs through into any `CryptoError` thrown during decrypt, so errors carry the caller's row identity. ~100 LOC.

### Updated: existing shims

**`src/lib/erp/factory.ts`** — `encryptCredentials` and `decryptCredentials` become thin async delegations:

```ts
export async function encryptCredentials(c: ERPCredentials): Promise<string> {
  return encryptJson(c);
}

export async function decryptCredentials(encrypted: string, row_locator?: string): Promise<ERPCredentials> {
  return decryptJson<ERPCredentials>(encrypted, { row_locator });
}
```

The function signatures change from synchronous to async. All six call sites are in async contexts already and need `await` added — mechanical change.

**`src/lib/integrations/slack.ts`** — Identical treatment for `encryptSlackCredentials` / `decryptSlackCredentials`. Twelve-ish Supabase call sites reference `slack_integrations` via these helpers; each gets the same `await` edit.

### New: developer tooling

**`scripts/gen-encryption-key.ts`** — One-shot script that generates a random 32-byte hex key and prints the env-var lines:

```
CREDENTIALS_ENCRYPTION_KEY=<64 random hex chars>
CREDENTIALS_ENCRYPTION_KEY_ID=v1
```

Invoked via a new `npm run crypto:gen` script in `package.json`. Uses `tsx` if already installed, otherwise plain Node. ~20 LOC.

### Updated: docs

**`.env.local.example`** — Replace the current placeholder line with:

```
# ERP + Slack credential encryption. Generate with: npm run crypto:gen
CREDENTIALS_ENCRYPTION_KEY=
CREDENTIALS_ENCRYPTION_KEY_ID=v1
# CREDENTIALS_ENCRYPTION_KEY_LEGACY=v0:<hex>,...  (for rotation — optional)
```

### Cutover: Supabase

**`supabase/migrations/NNNN_truncate_dummy_credentials.sql`** — One migration that empties the dummy rows in both tables. Applied to dev (`spllxotyxipdvfpkkvgu`) and prod (`lfujbwemavgiifkltrag`) per the project's Supabase invariant.

```sql
-- Dummy rows only. If this migration errors on prod because real rows
-- exist, STOP — someone wrote real credentials without running this slice
-- first, and a migration script is needed.
TRUNCATE TABLE erp_configurations CASCADE;
TRUNCATE TABLE slack_integrations CASCADE;
```

The plan enforces a manual verification step before applying this migration to prod (`SELECT COUNT(*)` first).

### Updated: `src/instrumentation.ts`

Add one line inside the existing `nodejs` branch:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    // Fail loud on bad crypto config BEFORE handling requests.
    const { encryptJson } = await import('./lib/crypto/envelope');
    await encryptJson({ startup_check: true });
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}
```

The startup-check encrypt call forces the provider factory to construct, the env parser to run, and the crypto primitive to round-trip. Any of `CRYPTO_MISSING_KEY`, `CRYPTO_BAD_KEY_FORMAT`, or an `OpenSSL` fault surfaces here and prevents the server from accepting requests.

### Boundary rule

Nothing outside `src/lib/crypto/` may call `node:crypto::createCipheriv` or `createDecipheriv` for symmetric encryption. ERP, Slack, and all future at-rest encryption flow through `encryptJson` / `decryptJson`. Enforced by convention and a grep-based lint rule that the plan will add.

## Envelope format

```
v1:${keyId}:${base64url(iv || ciphertext || authTag)}
```

- **`v1`** — format version. Only valid value today. Separates this format from future AEADs or framing changes; old rows stay on their original version and decrypt via the same code path.
- **`keyId`** — which key encrypted this row. Constrained to `^[a-zA-Z0-9_-]+$` so it can't contain the separator. Looked up in the `CipherProvider`'s registry at decrypt time.
- **`base64url(...)`** — URL-safe-base64 without padding, containing a single blob: the 12-byte random IV concatenated with the AES-256-GCM ciphertext concatenated with the 16-byte auth tag. Fixed offsets: first 12 bytes = IV, last 16 bytes = auth tag, middle = ciphertext.

Colons are a safe separator because both `v1` and the key ID are constrained, and base64url never emits colons.

## Data flow

### Encrypt

```
caller → encryptJson(obj)
  1. JSON.stringify(obj)                                   → plaintext bytes
  2. provider.encrypt(plaintext)
       env provider internals:
         a. getPrimaryKey()                                 → { id, key }
         b. randomBytes(12)                                 → iv
         c. createCipheriv('aes-256-gcm', key, iv)          → cipher
         d. cipher.update(plaintext) + cipher.final()       → ciphertext
         e. cipher.getAuthTag()                             → authTag (16 bytes)
         f. return { keyId: id, inner: concat(iv, ct, tag) }
  3. return `v1:${keyId}:${inner.toString('base64url')}`
```

### Decrypt

```
caller → decryptJson(envelope, { row_locator })
  1. split envelope on ':' → [version, keyId, data]
       ≠ 3 parts               → throw CRYPTO_BAD_ENVELOPE
  2. version ≠ 'v1'             → throw CRYPTO_BAD_VERSION
  3. Buffer.from(data, 'base64url')
       invalid base64          → throw CRYPTO_BAD_ENVELOPE
       length < 28             → throw CRYPTO_BAD_ENVELOPE  (12 iv + 16 tag minimum)
  4. provider.decrypt(keyId, inner)
       env provider internals:
         a. getKeyById(keyId) or throw CRYPTO_UNKNOWN_KEY_ID
         b. slice: iv = [0..12), authTag = [len-16..len), ciphertext = [12..len-16)
         c. createDecipheriv('aes-256-gcm', key, iv)        → decipher
         d. decipher.setAuthTag(authTag)
         e. decipher.update(ciphertext) + decipher.final()
            auth failure       → throw CRYPTO_AUTH_TAG_MISMATCH
         f. return plaintext bytes
  5. JSON.parse(plaintext.toString('utf-8'))
       parse failure           → throw CRYPTO_JSON_PARSE_FAIL
  6. return as generic T
```

### Key registry parsing (env provider)

At first `getCipherProvider()` call — warmed up from `instrumentation.ts` at server startup — the factory invokes `loadEnvKeyConfigFromProcessEnv(process.env)`:

```
Reads:
  CREDENTIALS_ENCRYPTION_KEY        required — 64 hex chars (32 bytes)
  CREDENTIALS_ENCRYPTION_KEY_ID     optional — defaults to "v1", ^[a-zA-Z0-9_-]+$
  CREDENTIALS_ENCRYPTION_KEY_LEGACY optional — comma-separated "id:hex" pairs

Produces:
  {
    primary: { id: "v1", key: Buffer<32> },
    legacy:  Map { "v0" → Buffer<32>, ... }
  }

Fails with:
  CRYPTO_MISSING_KEY       primary env var not set
  CRYPTO_BAD_KEY_FORMAT    any hex string not exactly 64 hex chars
                           any key ID not matching ^[a-zA-Z0-9_-]+$
                           legacy entry without ':' separator
                           legacy entry duplicating the primary key ID
                           primary key ID containing ':' or whitespace
```

The returned config is fed to `new EnvKeyCipherProvider(config)`. The registry is cached in a module-level variable; subsequent calls return the cached instance. No re-reads of `process.env`.

### Key rotation (future, no code changes needed)

1. `npm run crypto:gen` → new hex key.
2. Move the old key to `CREDENTIALS_ENCRYPTION_KEY_LEGACY` as `oldId:oldHex`.
3. Set the new key in `CREDENTIALS_ENCRYPTION_KEY`, pick a new `CREDENTIALS_ENCRYPTION_KEY_ID`.
4. Redeploy.

Old rows decrypt with the legacy key until they're rewritten. New writes use the new primary. A rotation cleanup script that selectively re-encrypts old rows is a future task, not needed for correctness.

## Error handling

### Complete reason-code list (eight codes)

| Code | Fires when | Ops response |
|---|---|---|
| `CRYPTO_MISSING_KEY` | `CREDENTIALS_ENCRYPTION_KEY` env var not set. Caught by the env parser in `provider.ts`. | Run `npm run crypto:gen` and set the env var. Only reachable at startup because `instrumentation.ts` warms the provider. |
| `CRYPTO_BAD_KEY_FORMAT` | Key string not exactly 64 hex characters, OR key ID contains `:` or whitespace, OR a legacy entry is malformed, OR a legacy ID duplicates the primary ID. Fields carry the offending ID. | Fix the env var. Usually a typo. |
| `CRYPTO_BAD_ENVELOPE` | Envelope string doesn't split into three colon-separated parts, OR inner blob isn't valid base64url, OR inner blob is shorter than 28 bytes (minimum IV + auth tag). | Row is corrupted at rest. The caller marks the integration as unusable and surfaces "Reconnect required" in the UI. No retry. |
| `CRYPTO_BAD_VERSION` | Envelope version token is not `v1`. Reserved — never fires today. | Deploy is behind HEAD. Upgrade code. |
| `CRYPTO_UNKNOWN_KEY_ID` | Envelope references a key ID not in the provider's registry. For env provider: not in `_KEY_LEGACY`. For KMS (future): alias doesn't resolve. Fields carry the unknown `key_id`. | Either add the missing legacy key back to the env, or accept that the row is unreadable by policy and mark the integration for reconnect. |
| `CRYPTO_AUTH_TAG_MISMATCH` | AES-GCM authentication check failed. Cause is one of: wrong key, tampered ciphertext, corrupted row. Fields carry `key_id` and `row_locator`. | **Pages via Sentry.** High-signal event. Investigate whether this is tampering or silent corruption. |
| `CRYPTO_JSON_PARSE_FAIL` | Decrypt succeeded but the plaintext bytes aren't valid JSON. Means a historical caller wrote non-JSON, or a type mismatch on `decryptJson<T>`. | Rare. Investigate the caller. |
| `CRYPTO_PROVIDER_UNAVAILABLE` | Future-only. Fires when a KMS-backed provider's remote service is unreachable. Reserved in the code list now so the interface is complete. | Retry with backoff. If persistent, mark the KMS provider as down and refuse to read credentials until recovery. |

### Structured fields on every `CryptoError`

Minimum on every error:
- `code` — one of the eight above
- `explanation` — human-readable, logged only
- `next_step` — human-readable, safe to surface
- `trace_id` — UUID generated at throw site
- `row_locator` — caller-provided string identifying the failing row (e.g., `"erp_configurations/id=abc-123"`). Optional on encrypt calls, expected on decrypt calls.

Per-code extras:
- `CRYPTO_BAD_KEY_FORMAT`: `key_id` (which env entry is malformed)
- `CRYPTO_UNKNOWN_KEY_ID`: `key_id` (what the envelope asked for)
- `CRYPTO_AUTH_TAG_MISMATCH`: `key_id` (which key was tried)

### Logs vs. user-facing response

Full error (code, explanation, next_step, all fields) → server logs + Sentry. User-facing response via `CryptoError::toUserFacing()` returns only `{ code, next_step, trace_id }` — never `row_locator`, never `key_id`, never any byte of ciphertext.

### Sentry integration

- **Every `CryptoError` is captured** as an exception with `code`, `row_locator`, and (where present) `key_id` as tags. None are routine noise.
- **`CRYPTO_AUTH_TAG_MISMATCH` pages** via the existing Sentry alert channel. This is the only code with real security implications — it means either tampering or silent data corruption, and it needs immediate human attention. All other codes are triage-next-business-day operational issues.

### Caller contract

Callers that decrypt credentials pattern-match on `code`:

- **`CRYPTO_MISSING_KEY` / `CRYPTO_BAD_KEY_FORMAT`** — only reachable at startup, not at request time, because `instrumentation.ts` catches them first.
- **`CRYPTO_BAD_ENVELOPE` / `CRYPTO_BAD_VERSION` / `CRYPTO_JSON_PARSE_FAIL`** — row is corrupted. Caller marks integration as `status='corrupted'` or equivalent, surfaces "reconnect required" in the UI, does not retry.
- **`CRYPTO_UNKNOWN_KEY_ID`** — same UX as corrupted. Either ops adds the legacy key back, or the row is permanently unreadable.
- **`CRYPTO_AUTH_TAG_MISMATCH`** — same UX as corrupted, plus Sentry pages.
- **`CRYPTO_PROVIDER_UNAVAILABLE`** — future-only. Retry once, then treat as transient upstream failure.

This slice does not update the six existing call sites to pattern-match; they continue to let errors bubble up as today. The contract is documented so the Xero adapter and future Slack cleanup can adopt it cleanly.

## Testing

Three layers.

### Layer 1 — Unit tests (everything that matters)

Plain Vitest. No Testcontainers, no MSW, no fixtures, no environment pollution between tests. Runs in milliseconds.

**`tests/crypto/provider.test.ts`** — `EnvKeyCipherProvider` behavior:

- Round-trip: encrypt → decrypt returns original plaintext for plaintexts of varying sizes.
- Ciphertext uniqueness: encrypting the same plaintext twice produces different ciphertexts (proves the nonce is fresh and random).
- Primary key ID returned in the encrypt result.
- Legacy keys: construct a provider with primary `v2` and legacy `{ v1, v0 }`; all three resolve on decrypt, only `v2` encrypts.
- `decrypt('notakey', ...)` throws `CRYPTO_UNKNOWN_KEY_ID`.
- Tampered ciphertext (flip one byte) throws `CRYPTO_AUTH_TAG_MISMATCH`.
- Wrong-key decrypt (two providers with same ID but different bytes) throws `CRYPTO_AUTH_TAG_MISMATCH`.
- Truncated inner blob (< 28 bytes) throws `CRYPTO_BAD_ENVELOPE` or wrapped auth error — behavior pinned by the test.

**`tests/crypto/env-config.test.ts`** — `loadEnvKeyConfigFromProcessEnv`:

- Missing primary → `CRYPTO_MISSING_KEY`.
- Primary key wrong length → `CRYPTO_BAD_KEY_FORMAT`.
- Primary key non-hex → `CRYPTO_BAD_KEY_FORMAT`.
- Primary key with whitespace → trimmed and accepted.
- `_KEY_LEGACY` empty string → no legacy keys (not an error).
- `_KEY_LEGACY` single entry → registry contains primary + one legacy key.
- `_KEY_LEGACY` multiple comma-separated entries → all parsed.
- `_KEY_LEGACY` malformed entry (missing `:`) → `CRYPTO_BAD_KEY_FORMAT` naming the broken entry.
- `_KEY_LEGACY` entry with ID duplicating the primary → `CRYPTO_BAD_KEY_FORMAT`.
- `_KEY_ID` containing `:` or whitespace → `CRYPTO_BAD_KEY_FORMAT`.
- Missing `_KEY_ID` → defaults to `"v1"`.

**`tests/crypto/envelope.test.ts`** — `encryptJson` / `decryptJson` with a fake `CipherProvider` injected:

- End-to-end round-trip returns the original object.
- Round-trip with a typed generic (`decryptJson<ERPCredentials>(...)`).
- Envelope output matches `^v1:[a-zA-Z0-9_-]+:[A-Za-z0-9_-]+$` (no padding).
- Malformed envelopes (`'v1'`, `'v1:only'`, `''`, `'v1::data'`, `'v1:id:'`) all throw `CRYPTO_BAD_ENVELOPE`.
- `'v2:v1:...'` throws `CRYPTO_BAD_VERSION`.
- Non-base64url inner throws `CRYPTO_BAD_ENVELOPE`.
- Fake provider whose decrypt returns non-UTF-8 bytes → `CRYPTO_JSON_PARSE_FAIL`.
- `CryptoError::toUserFacing()` exposes only `code`, `next_step`, `trace_id`.
- `row_locator` plumbs through into the error's `fields.row_locator`.

**`tests/crypto/errors.test.ts`** — factory per reason code, same pattern as the Xero errors test.

### Layer 2 — Integration tests (shims work end-to-end)

Two tests, one per shim. These are the only tests that mutate `process.env`.

**`tests/crypto/erp-shim.test.ts`**:

```ts
it('encryptCredentials → decryptCredentials round-trips via the real provider', async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.CREDENTIALS_ENCRYPTION_KEY_ID = 'test-v1';
  delete process.env.CREDENTIALS_ENCRYPTION_KEY_LEGACY;
  vi.resetModules();
  const { encryptCredentials, decryptCredentials } = await import('@/lib/erp/factory');
  const original = { apiUrl: 'https://api.xero.com', clientId: 'ci', clientSecret: 'cs' };
  const roundTripped = await decryptCredentials(await encryptCredentials(original));
  expect(roundTripped).toEqual(original);
});
```

**`tests/crypto/slack-shim.test.ts`** — identical pattern with `SlackCredentials`.

### Layer 3 — Startup-check test

**`tests/crypto/startup.test.ts`** — verifies `instrumentation.ts::register()` fails loud when the env var is missing:

```ts
it('register() throws when CREDENTIALS_ENCRYPTION_KEY is missing', async () => {
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.NEXT_RUNTIME = 'nodejs';
  vi.resetModules();
  const { register } = await import('@/instrumentation');
  await expect(register()).rejects.toMatchObject({ code: 'CRYPTO_MISSING_KEY' });
});
```

### Manual cutover smoke test

Not automated — documented as one paragraph in the plan's final verification step:

1. Apply the TRUNCATE migration to dev Supabase.
2. Start the dev server. Confirm it starts cleanly with `CREDENTIALS_ENCRYPTION_KEY` set.
3. Temporarily unset the env var and restart. Confirm the server refuses to boot with a clear error mentioning `npm run crypto:gen`.
4. Restore the env var. Walk through the ERP mock-connect flow. Confirm the stored row's `credentials` column starts with `v1:<id>:` and round-trips cleanly.
5. Same drill for the Slack connect flow.

### What's not in the test plan

- No fuzz testing on envelope parsing — the parser is small enough that unit cases exhaust the failure modes.
- No performance benchmarks — AES-GCM on <1KB plaintext is ~100µs, far below any request budget.
- No Testcontainers — the crypto module has no DB logic.
- No manual fixture recording — no external service to record against.

## Future work (explicitly out of scope, documented to preserve the migration path)

1. **KMS-backed provider.** Write `src/lib/crypto/kms-provider.ts` implementing `CipherProvider` against AWS KMS (or GCP KMS, or Vault transit). Flip `CRYPTO_PROVIDER=kms` in Vercel env. Existing envelope format works as-is — the only thing that changes is how `provider.encrypt` / `provider.decrypt` is implemented. Env-provider stays available for local dev. Migration timing: when Vantor has its first enterprise customer asking about key management, or its first SOC 2 audit, or whichever comes first.

2. **Background re-encryption rotation script.** `scripts/rotate-encryption-key.ts` that reads every row from `erp_configurations` and `slack_integrations`, decrypts with the current key, re-encrypts with a new primary, and updates the row. Not needed unless we ever want to fully retire an old key rather than let it live forever in `_KEY_LEGACY`.

3. **AAD binding for row-level integrity.** Pass row identity (table + primary key) as Additional Authenticated Data into `encrypt` and `decrypt` so a ciphertext swap from one row to another fails the auth tag check. Defers to a separate spec if the threat model ever demands it.

4. **Cleanup of `src/lib/agent/tools.ts:267`** which references a nonexistent `credentials_enc` column. Pre-existing bug, unrelated, separate fix.

5. **Caller contract adoption.** The six existing call sites still let `CryptoError`s bubble up generically instead of pattern-matching on `code`. When the Xero adapter lands, it adopts the documented contract; the existing sites can be updated later as they're touched.

## Open questions resolved during brainstorming

1. **No existing rows to migrate** — dev and prod `erp_configurations` and `slack_integrations` contain dummy data only. TRUNCATE at cutover, no migration script.
2. **Slack included in the same slice** — same base64 passthrough bug, same intended env var, same shape. Thin shim over the shared helper.
3. **Key-ID envelope from day one** — `v1:${keyId}:${base64url(iv||ct||tag)}`. Rotation and future KMS migration are drop-in as a result.
4. **Fail-loud everywhere** — server refuses to boot without `CREDENTIALS_ENCRYPTION_KEY`. Startup check lives in the existing `src/instrumentation.ts::register()`, which already runs Sentry setup in the `nodejs` branch. No config changes needed — Next.js 14.2.29 has stable instrumentation.
5. **Pluggable `CipherProvider` interface** rather than direct env-var access from `envelope.ts`. Future KMS migration is one new file, not a refactor. ~30 LOC more than the tightest implementation.
6. **Async signature everywhere** — required because future KMS providers are async. Six existing call sites are already in async contexts and need one `await` each.
7. **Random 12-byte nonces** — standard GCM choice. Birthday bound is ~2^48 ops, nowhere near any Vantor volume.
8. **No AAD.** Threat model doesn't justify it for this slice.
9. **`CRYPTO_AUTH_TAG_MISMATCH` pages, all other codes capture-but-don't-page.** Auth-tag mismatch is the only code with real security implications.
10. **Eight reason codes.** Complete list; additional codes added to `errors.ts` only, never invented ad-hoc at throw sites.
11. **DI-heavy tests.** Only the two shim tests and the startup test touch `process.env`; everything else uses injected fake providers.

## Appendix — Slack table verification

The Slack integration table is `slack_integrations` (verified via grep — 12 call sites across `src/lib/notifications/service.ts`, `src/app/api/integrations/slack/**`, `src/app/api/cron/treasury-analysis/route.ts`, and `src/app/api/treasury/recommendations/generate/route.ts`). The cutover migration TRUNCATEs this table.

## Appendix — Next.js instrumentation version check

Next.js is `^14.2.29`, well past 14.0.4 where `src/instrumentation.ts` became stable. No `experimental.instrumentationHook` flag is needed. The file already exists and wires up Sentry; the encryption startup check is an additive one-liner in the existing `register()` function.
