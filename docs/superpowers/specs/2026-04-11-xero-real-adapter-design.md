# Xero Real Adapter — Design Spec

**Date:** 2026-04-11
**Status:** Proposed
**Branch:** `feature/xero-real-adapter`

## Goal

Replace the mock `XeroMockAdapter` with a production-grade `XeroRealAdapter` that talks to the real Xero API via OAuth 2.0, reading vendors and bills into Vantor's obligation pipeline and writing back bill payments to close the AP loop after Vantor executes stablecoin transfers on-chain.

This is the first real ERP adapter in Vantor. The SAP / Oracle / NetSuite adapters stay mocked after this slice lands.

## Non-goals

- Generic GL journal posting (yield accruals, gas costs, fee journals). These are Manual Journal use cases, distinct from AP payments, and get a separate slice later.
- Creating new bills in Xero from Vantor. Bills originate in the ERP.
- Reconciling Xero bank accounts to on-chain state. Out of scope entirely.
- Background worker for proactively refreshing dormant connections against the 60-day inactivity expiry. Deferred.
- Postgres advisory locks for airtight cross-lambda refresh mutual exclusion. Deferred.
- Email alerts on auth expiry. Deferred; UI state in `/settings/erp` is the only notification.
- A multi-tenant picker UI when a user has multiple Xero orgs. MVP auto-picks the first `ORGANISATION` and logs the rest.
- Automatic retry on Xero rate limits (HTTP 429). Caller-handled.
- Supply-chain upgrades to `xero-node` — we are not using the official SDK. See Approach below.

## Hard dependency

This spec assumes `encryptCredentials` / `decryptCredentials` in `src/lib/erp/factory.ts` use real AES-256-GCM keyed by a `CREDENTIALS_ENCRYPTION_KEY` environment variable. Today they are base64 passthrough, which is unacceptable for storing rotating Xero refresh tokens.

A separate spec, **`2026-04-11-erp-credentials-encryption-design.md`**, must be written, approved, and implemented before any Xero implementation work begins. This Xero slice's implementation plan will state the dependency explicitly and fail loudly at server startup if `CREDENTIALS_ENCRYPTION_KEY` is missing.

## Approach

Hand-rolled `fetch`-based HTTP client (~250 LOC) with Zod schemas at every response boundary. **Not** the official `xero-node` SDK — the SDK ships every Xero API surface (≈3 MB) when we need four endpoints, and it hides the OAuth refresh flow behind its own abstractions right where we most need to audit and own the code. Owning ~250 lines of client code is worth more than the ~50 lines we'd save by pulling in the SDK, because this is a financial integration and the auth model is the hard part.

Zod-parsed responses are the source of truth for types throughout the adapter. If Xero ever changes a wire shape, Zod parse failure is the signal — not a TypeScript compile error, because there's no compile-time connection between our types and Xero's actual responses.

## Components

Everything Xero-specific lives under `src/lib/erp/real/xero/`. Nine net-new files in the feature core, updates to eight existing files for the shared-contract change, removal of a dormant `/api/erp/gl-post` route plus its `gl_postings` table, a new `bill_payments` table, and new test infrastructure (files counted in §Test surface). See §Deletions and §Updates to existing files for the full manifest.

### Core adapter (`src/lib/erp/real/xero/`)

1. **`client.ts`** — `XeroClient` class. `fetch` wrapper, PKCE authorization URL generation, authorization-code-for-token exchange, refresh rotation, per-connection in-process mutex, `xero-tenant-id` header injection, 401-retry-once, 429 parsing, 5xx classification. ~250 LOC.
2. **`schemas.ts`** — Zod schemas for every consumed Xero response: `TokenResponse`, `ConnectionsResponse`, `ContactsResponse`, `InvoicesResponse`, `PaymentResponse`. Unknown keys ignored; required-field drift fails parsing.
3. **`mapper.ts`** — Pure functions converting Zod-parsed Xero shapes into Vantor shapes (`ERPVendorRaw`, `ERPInvoiceRaw`, `ERPBillPaymentResult`). No I/O. Trivially unit-testable.
4. **`adapter.ts`** — `XeroRealAdapter implements IERPAdapter`. Thin — each method 5–10 lines: call client, pipe through mapper, wrap errors from `errors.ts`.
5. **`tokens.ts`** — Token persistence. Loads + decrypts from `erp_configurations`, persists rotated refresh tokens atomically, owns the in-process refresh mutex keyed by `connection_id`.
6. **`errors.ts`** — `XeroError` factory. One file, one constructor per reason code. Every Xero-originated error in the adapter comes from here. See §Error Handling for the complete reason-code list.

### Auth surface (`src/app/api/erp/xero/`)

7. **`authorize/route.ts`** — GET handler. Generates 43-byte PKCE verifier + SHA-256 challenge, 32-byte state token, sets a signed HTTP-only `xero_oauth` cookie (10 min TTL) carrying `{ verifier, state, user_id, enterprise_id }`, and 302s to Xero's authorize URL.
8. **`callback/route.ts`** — GET handler. Validates state against cookie, exchanges code for tokens, resolves the tenant via `GET /connections`, auto-picks the first `tenantType === 'ORGANISATION'` (logs others), encrypts and persists tokens to `erp_configurations`, clears the cookie, 302s to `/settings/erp?xero=connected`.

### Factory wire-up

9. **`src/lib/erp/factory.ts`** — update so that when `ERP_USE_MOCK !== 'true'` and `provider === 'xero'`, returns `new XeroRealAdapter(credentials)`. Other three providers still throw `Real ERP adapter for 'X' not implemented`.

### Database

10. **Supabase migration** — add columns to `erp_configurations`:
    - `xero_tenant_id` (text) — the Xero tenant UUID
    - `xero_bank_account_id` (text) — the Xero bank account ID payments are recorded against
    - `access_token_expires_at` (timestamptz)
    - `refresh_token_rotated_at` (timestamptz)
    - `status` (text, check-constrained to `active | expired | needs_reconnect`)

    Applied to **both** dev (`spllxotyxipdvfpkkvgu`) and prod (`lfujbwemavgiifkltrag`) per the project's Supabase invariant.

### `IERPAdapter` contract change (affects all providers)

The current `IERPAdapter.postGLEntry` is the wrong primitive for the treasury ↔ ERP use case (see §Data Flow — Flow C). Replace it:

- **Remove** `postGLEntry(payload: ERPGLPostPayload): Promise<ERPGLPostResult>`
- **Add** `recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult>`

Where:
```ts
type ERPBillPaymentPayload = {
  invoiceId: string;          // ERP-side invoice/bill ID
  amount: number;
  currency: string;           // ISO 4217
  paymentDate: string;        // ISO yyyy-mm-dd
  reference: string;          // free-text, e.g. 'Vantor-USDC'
  externalTxHash: string;     // the on-chain tx Vantor just executed
};

type ERPBillPaymentResult = {
  externalPaymentId: string;  // ERP-side payment ID
  status: 'recorded';
  message: string;
};
```

All four mock adapters (`sap-mock`, `oracle-mock`, `xero-mock`, `netsuite-mock`) get their `postGLEntry` replaced with `recordBillPayment`. The blast radius is small because no production caller of `postGLEntry` exists in the live UI — but see §Deletions below; a dormant route and table need to be removed as part of this slice to unblock the interface change.

### Deletions (dormant GL-post surface)

A previous unfinished feature left a dormant `/api/erp/gl-post` route and a `gl_postings` Supabase table in the codebase. Neither is called from any frontend code or from any other backend handler — verified by `grep -r "/api/erp/gl-post" src/` returning zero results outside the route file itself. The route was built to exercise the mock `postGLEntry` method and never wired to a user-visible flow.

Because `postGLEntry` is being removed from `IERPAdapter`, this dormant surface would break the compile if left in place, and keeping both a dormant GL-post path and a live bill-payment path would double the mental surface area for no real benefit. This slice therefore removes:

- `src/app/api/erp/gl-post/route.ts` — the route file.
- `gl_postings` table — Supabase migration drops it. Applied to dev and prod.
- `gl_post` audit log action string — removed from `src/lib/audit/logger.ts` if it's hardcoded anywhere as a known action.
- `gl_postings` references in `src/lib/test-mode/seed/erp.ts` and `src/lib/test-mode/seed/wipe.ts` — seed + wipe helpers updated to touch `bill_payments` instead (see below).

### Database (continued)

In addition to the `erp_configurations` column additions above, this slice adds a `bill_payments` table — the `recordBillPayment` results table, replacing the dropped `gl_postings` table. Columns:

- `id uuid primary key`
- `user_id uuid references auth.users`
- `enterprise_id uuid`
- `erp_config_id uuid references erp_configurations`
- `invoice_id text` — ERP-side invoice/bill ID (not a Vantor UUID)
- `external_payment_id text` — ERP-side payment ID returned by `recordBillPayment`
- `external_tx_hash text` — on-chain tx hash Vantor paid from
- `amount numeric`
- `currency text`
- `payment_date date`
- `reference text`
- `status text check (status in ('recorded','failed'))`
- `response_data jsonb`
- `created_at timestamptz default now()`

Applied to dev and prod Supabase. RLS policies mirror the existing `gl_postings` policies (user-scoped + enterprise-scoped).

### Updates to existing files

Six files change to accommodate the `IERPAdapter` contract change:

- `src/types/erp.ts` — remove `ERPGLPostPayload` / `ERPGLPostResult`, add `ERPBillPaymentPayload` / `ERPBillPaymentResult`, update `IERPAdapter` method signature.
- `src/lib/erp/factory.ts` — add the real Xero branch.
- `src/lib/erp/mock/xero-mock.ts` — rename method, update payload shape, return the new result type.
- `src/lib/erp/mock/sap-mock.ts` — same contract conformance.
- `src/lib/erp/mock/oracle-mock.ts` — same.
- `src/lib/erp/mock/netsuite-mock.ts` — same.

Plus the seed-helper updates in `src/lib/test-mode/seed/erp.ts` and `wipe.ts` already noted under Deletions.

### Test surface

- `tests/xero/` — unit + integration tests (Vitest + MSW).
- `tests/fixtures/xero/*.json` — recorded Xero responses, committed to repo.
- `tests/xero-live/` — live Demo Company suite, gated on `XERO_LIVE_TESTS=1`.
- `tests/helpers/testcontainers-postgres.ts` — Layer 2 Postgres bootstrap.
- `scripts/xero-record-fixtures.ts` — one-shot fixture recorder hitting the Demo Company.

### Boundary rule

Nothing outside `src/lib/erp/real/xero/` imports Xero API shapes. The only types that cross the boundary are Vantor's existing `ERPVendorRaw`, `ERPInvoiceRaw`, and the new `ERPBillPaymentPayload` / `ERPBillPaymentResult`. This is enforced by convention; if violated, it means the adapter pattern was bypassed.

## Data Flow

### Flow A — OAuth connect (first-time)

```
User clicks "Connect Xero" on /settings/erp
  │
  ▼
GET /api/erp/xero/authorize
  • generate 43-byte PKCE verifier + SHA-256 challenge
  • generate 32-byte state token
  • set signed HTTP-only cookie `xero_oauth` { verifier, state, user_id, enterprise_id } — 10 min TTL
  • 302 → https://login.xero.com/identity/connect/authorize?
           response_type=code
          &client_id=$CLIENT_ID
          &redirect_uri=https://www.vantor.xyz/api/erp/xero/callback
          &scope=offline_access accounting.contacts.read accounting.transactions accounting.journals
          &state=$STATE
          &code_challenge=$CHALLENGE
          &code_challenge_method=S256
  │
  ▼
User authorizes in Xero, picks org, clicks Allow
  │
  ▼
GET /api/erp/xero/callback?code=…&state=…
  • read `xero_oauth` cookie, verify signature, compare state → on mismatch throw ERP_XERO_STATE_MISMATCH
  • POST https://identity.xero.com/connect/token (form-encoded)
      grant_type=authorization_code, code, code_verifier, redirect_uri, client_id, client_secret
    → { access_token, refresh_token, expires_in, id_token }
  • GET https://api.xero.com/connections with Bearer → list of { id, tenantId, tenantType, tenantName }
  • auto-pick first tenant where tenantType === 'ORGANISATION'; log the rest
  • GET https://api.xero.com/api.xro/2.0/Accounts?where=Type=="BANK" → resolve xero_bank_account_id
      (MVP: first BANK account; future: user picker)
  • encrypt { access_token, refresh_token, client_id, client_secret } via encryptCredentials
  • UPSERT erp_configurations ON CONFLICT (user_id, provider):
      user_id, enterprise_id, provider='xero', credentials=<encrypted>,
      xero_tenant_id, xero_bank_account_id,
      access_token_expires_at = now() + expires_in,
      refresh_token_rotated_at = now(),
      status = 'active',
      is_active = true
  • clear `xero_oauth` cookie
  • 302 → /settings/erp?xero=connected
```

### Flow B — Fetch vendors or invoices

```
Existing sync endpoint (POST /api/erp/sync)
  │
  ▼
Load erp_configurations row for (user_id, enterprise_id, provider='xero') → decrypt credentials
  │
  ▼
getERPAdapter('xero', credentials) → XeroRealAdapter
  │
  ▼
adapter.fetchVendors()  →  client.getContacts()
  │
  ▼
XeroClient.getContacts()
  ├─ check access_token_expires_at: if < now() + 60s, proactive refresh (§Token Lifecycle)
  ├─ GET https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier==true
  │     Authorization: Bearer $access_token
  │     xero-tenant-id: $xero_tenant_id
  │     Accept: application/json
  ├─ 401 → reactive refresh + retry once
  │        second 401 → throw ERP_XERO_AUTH_EXPIRED
  ├─ 429 → read Retry-After → throw ERP_XERO_RATE_LIMITED
  ├─ 5xx or network → throw ERP_XERO_UPSTREAM_FAILURE
  └─ parse body through ContactsResponse Zod schema
       parse failure → throw ERP_XERO_VALIDATION with zod issues + first 200 bytes of body
  │
  ▼
mapper.xeroContactsToVendors(parsed) → ERPVendorRaw[]
```

`fetchInvoices` follows the identical pattern against `GET /api.xro/2.0/Invoices?where=Type=="ACCPAY"` (Xero ACCPAY = bills = Vantor's payables).

### Flow C — Record bill payment (write path)

After Vantor executes an on-chain payment for an obligation, it writes back to Xero to close the AP loop:

```
Existing payment-complete handler → adapter.recordBillPayment(payload)
  │
  ▼
client.createPayment({
  Invoice: { InvoiceID: payload.invoiceId },
  Account: { AccountID: connection.xero_bank_account_id },
  Date:      payload.paymentDate,
  Amount:    payload.amount,
  CurrencyRate: 1,          // payment currency = invoice currency in MVP
  Reference: `${payload.reference} tx:${payload.externalTxHash}`,
})
  • POST https://api.xero.com/api.xro/2.0/Payments
    (same auth/retry/refresh contract as reads)
  • parse PaymentResponse with Zod
  │
  ▼
mapper.xeroPaymentToResult(parsed) → { externalPaymentId: PaymentID, status: 'recorded', message }
```

**Why Payments, not Manual Journals**: A Xero Manual Journal is for non-cash GL adjustments (depreciation, accruals, reclassifications). If Vantor used a Manual Journal to mark a bill as paid, the books would balance but the bill would stay showing `Unpaid` in Xero's AP subledger, because Manual Journals bypass the subledger. The AP clerk would chase a vendor for money that's already been sent. `POST /api.xro/2.0/Payments` is the correct primitive: it marks the bill paid, updates the AP subledger, and records the cash outflow from the configured bank account in one call.

This is why the `postGLEntry` → `recordBillPayment` contract change is load-bearing, and why `xero_bank_account_id` replaces the `xero_default_offset_account` we had briefly considered. Payments carry the bank account inline; no offset needed.

## Token Lifecycle

### The one invariant

**Save the new refresh token to the database before doing anything else with it.** Xero rotates refresh tokens on every use — the old one dies the moment a new one is issued. If Vantor refreshes a token and then crashes or fails to persist before continuing, the user is locked out until they manually reconnect. No recovery path on Xero's side.

### Token lifetimes

- Access token: **30 minutes** (Xero docs).
- Refresh token: rotates on every use, dies after **60 days of inactivity**.

### When we refresh

Two triggers, both active:

- **Proactive**: before every API call, check `access_token_expires_at`. If < `now() + 60s`, refresh first.
- **Reactive**: if an API call returns 401 anyway (clock skew, server-side revocation), force refresh and retry **once**. Second 401 → give up with `ERP_XERO_AUTH_EXPIRED`.

The proactive path is the main path. The reactive path is the safety net.

### Preventing the refresh race

Two concurrent API calls on an expired token could both trigger refresh in parallel. The first wins, rotates the token, and persists the new one. The second's refresh request uses an already-rotated token → Xero returns `invalid_grant` → that request marks the connection expired → user sees "Reconnect Xero" on a perfectly healthy connection.

Two layered defenses:

1. **In-process mutex** — `Map<connection_id, Promise<TokenResponse>>` inside `tokens.ts`. If request A is already refreshing connection X, request B awaits A's promise instead of starting its own.
2. **Reload-before-refresh** — before POSTing to `/connect/token`, re-read the `erp_configurations` row. If the refresh token in the DB doesn't match the one we started with, some *other* Node process already refreshed. Use the DB's current tokens and skip the refresh entirely.

Defense 1 handles concurrent requests inside one Vercel lambda. Defense 2 handles concurrent requests across different lambdas — optimistic concurrency via row-read, not true mutual exclusion, but sufficient for the realistic QPS profile. Postgres advisory locks via `pg_try_advisory_lock` would close the remaining race entirely at the cost of a DB round-trip per refresh; deferred until we see `invalid_grant` in logs indicating the race is actually firing.

### Refresh state machine

```
                   ┌──────────────┐
                   │   VALID      │  access token, not near expiry
                   └──────┬───────┘
                          │
                          │ expires_at < now() + 60s   (proactive)
                          │ OR API call returns 401     (reactive)
                          ▼
                   ┌──────────────┐
    acquire lock → │  REFRESHING  │  per-connection mutex held
                   └──────┬───────┘
                          │
         ┌────────────────┼──────────────────┐
         │                │                  │
      success         5xx/network        invalid_grant
         │                │                  │
         ▼                ▼                  ▼
   persist new       release lock,      mark connection
   tokens FIRST,     throw              as expired,
   then release      UPSTREAM           throw AUTH_EXPIRED
   lock, then                           (user must reconnect)
   retry API call
```

### Refresh algorithm (`tokens.ts::refreshAndPersist`)

```
1. acquireMutex(connection_id)                                  // in-process
2. reload erp_configurations row
   if row.refresh_token !== oldRefreshToken:
     releaseMutex()
     return { access_token: row.access_token, refresh_token: row.refresh_token }
3. POST https://identity.xero.com/connect/token
   grant_type=refresh_token, refresh_token=oldRefreshToken, client_id, client_secret
4. on 400 invalid_grant:
     UPDATE erp_configurations SET status='expired' WHERE id = connection_id
     releaseMutex()
     throw ERP_XERO_AUTH_EXPIRED
5. on 5xx / network error:
     releaseMutex()
     throw ERP_XERO_UPSTREAM_FAILURE
6. on 200:
     parse TokenResponse via Zod
     UPDATE erp_configurations SET
       credentials_encrypted = encrypt({ ...new tokens, client_id, client_secret }),
       access_token_expires_at = now() + expires_in,
       refresh_token_rotated_at = now()
     WHERE id = connection_id
     if UPDATE fails:
       log ERP_XERO_REFRESH_PERSIST_FAILURE (new tokens in memory)
       retry UPDATE up to 3 times with exponential backoff
       if all retries fail:
         mark connection as 'needs_reconnect'
         throw ERP_XERO_REFRESH_PERSIST_FAILURE
     releaseMutex()
     return { access_token, refresh_token }
```

The retried API call happens **only after** step 6's UPDATE commits. If the UPDATE fails, the user's current request fails with `ERP_XERO_REFRESH_PERSIST_FAILURE`, and the connection is left in a state that will force a reconnect. Failing the current request is acceptable; persisting stale tokens is not.

### First-connect token persistence

Same schema as refresh except `refresh_token_rotated_at` is set to the connect time. The callback route uses a `persistInitialTokens` helper in `tokens.ts` so there's one and only one code path that writes token fields to Supabase.

## Error Handling

Every error that leaves `src/lib/erp/real/xero/` is a `XeroError` built by the `errors.ts` factory. Each carries a **reason code**, a **human-readable explanation**, a **next step**, a **trace ID**, and **structured fields**, per the `feedback_vantor_error_design` memory note. No generic `Error`s escape the adapter boundary.

### Complete reason-code list

| Reason code | When it fires | Next step shown to user |
|---|---|---|
| `ERP_XERO_STATE_MISMATCH` | OAuth callback `state` ≠ signed cookie. CSRF defense. | "Restart the Xero connection from Settings → ERP." |
| `ERP_XERO_NOT_CONNECTED` | Caller requests adapter for a user+enterprise with no `erp_configurations` row for provider='xero'. | "Connect Xero from Settings → ERP." |
| `ERP_XERO_AUTH_EXPIRED` | Refresh returned `invalid_grant`, OR retried API call still 401s. Connection is dead. | "Reconnect Xero from Settings → ERP." |
| `ERP_XERO_REFRESH_PERSIST_FAILURE` | Xero refresh succeeded but 3 consecutive DB writes failed. New tokens in memory, unsaved. | "Try the action again in a moment. If it keeps failing, contact support with this trace ID." |
| `ERP_XERO_RATE_LIMITED` | 429. Fields carry `retry_after_seconds`, `daily_limit_remaining`. | "Xero is throttling this connection. Vantor will resume automatically in N seconds." |
| `ERP_XERO_TENANT_UNKNOWN` | `xero-tenant-id` no longer present in `GET /connections` — user removed Vantor from the Xero side. | "This Xero connection was removed from the Xero side. Reconnect from Settings → ERP." |
| `ERP_XERO_UPSTREAM_FAILURE` | Any 5xx or network error, including against the token endpoint. | "Xero is having trouble right now. Try again in a moment." |
| `ERP_XERO_VALIDATION` | A Xero response body failed Zod parsing. Fields carry Zod issue list + first 200 bytes of body. | "Vantor needs to update its Xero integration. The engineering team has been notified with this trace ID." |

`ERP_XERO_NOT_IMPLEMENTED` is **not** present — `recordBillPayment` ships in this slice.

### Structured fields on every error

Minimum on every `XeroError`:
- `connection_id`
- `xero_tenant_id`
- `endpoint` (Xero API path)
- `trace_id` — Xero's `X-Trace-Id` response header if present, otherwise a Vantor-generated UUID

Per-code extras:
- `ERP_XERO_RATE_LIMITED`: `retry_after_seconds`, `daily_limit_remaining`
- `ERP_XERO_VALIDATION`: `zod_issues[]`, `body_prefix` (200 bytes, redacted of tokens)
- `ERP_XERO_AUTH_EXPIRED`: `refresh_token_rotated_at` (last successful refresh) — immediately distinguishes "broke 45 days ago" from "broke one second ago"

### Logs vs. user response

The **full error** (reason code, explanation, next step, all fields) lands in server logs and Sentry. The **user-facing response** includes reason code + next step + trace ID only. Never raw Zod issues, never Xero response bodies, never tokens or any substring of tokens. `errors.ts::toUserFacing()` enforces the split; the internal and external shapes come from one object via two different serializers.

### Sentry integration

- **Every error except `ERP_XERO_RATE_LIMITED`** is captured as an exception with structured fields as tags (`reason_code`, `connection_id`, `xero_tenant_id`). 429s are expected background noise and would drown out real signal.
- **`ERP_XERO_VALIDATION` pages** via the existing Sentry alert channel. This is the "Xero changed their wire format" signal — the adapter is partially broken and needs human attention, not log triage.

### Non-goals for the error path

- Automatic retry on 429. Throw, let the caller handle it. A background retry queue is a separate project because rate limits are per-tenant and retries must coordinate across all of a tenant's in-flight requests.
- Partial-success handling for bulk operations. This slice only uses list-GETs and single-writes. When bulk endpoints land later, the error model will need extending.

## Testing

Three layers, each answering a different question.

### Layer 1 — Unit tests (fast, run always)

Pure functions only. No network, no DB, no mocking framework beyond the Vitest defaults. Run in milliseconds.

Covers:
- Every Zod schema in `schemas.ts`: minimal example, edge-case example (missing optional, unknown extra, wrong type on required field).
- Every `mapper.ts` pure function: input → output, no side effects.
- Every `tokens.ts` pure helper: expiration math, token-response parsing.
- Every `errors.ts` factory: structured fields are set correctly per reason code.

### Layer 2 — Integration tests (MSW + Testcontainers Postgres, run on every PR)

Exercises the full `XeroClient` → `XeroRealAdapter` stack with:
- **MSW** intercepting every outbound `fetch` to `*.xero.com` and serving recorded fixtures from `tests/fixtures/xero/*.json`.
- **Testcontainers** spinning up a real Postgres instance for `erp_configurations` state. Migrations applied at test start; container torn down at test end. Implemented via `tests/helpers/testcontainers-postgres.ts`.

Covers:
- **Auth state machine**: token valid (normal path), token expired (proactive refresh), 401 on API call (reactive refresh + retry), 401 after retry (give up → `ERP_XERO_AUTH_EXPIRED`), 429 (→ `ERP_XERO_RATE_LIMITED` with parsed `Retry-After`), 5xx (→ `ERP_XERO_UPSTREAM_FAILURE`), `invalid_grant` on refresh (→ connection marked expired).
- **Refresh race**: fire two `fetchVendors` calls concurrently on an expired token, assert (a) exactly one refresh request hits the MSW handler, (b) both calls succeed, (c) the new refresh token is persisted to Postgres exactly once, (d) the final row has `access_token_expires_at` in the future.
- **Persist-first invariant**: simulate a Postgres UPDATE failure after a successful Xero refresh response, assert the error is `ERP_XERO_REFRESH_PERSIST_FAILURE` and the connection row is marked `needs_reconnect`.
- **Reload-before-refresh**: simulate a sibling process having already refreshed (by mutating the Postgres row between lock acquisition and the Xero POST), assert the refresh call is **not** made and the client uses the DB's current tokens.
- **Connect callback end-to-end**: MSW-mocked `/connect/token` + `/connections` + `/Accounts`, drive `/api/erp/xero/callback`, assert encrypted tokens land in Postgres and the 302 to `/settings/erp?xero=connected` fires.
- **`recordBillPayment` happy path**: assert the outbound `POST /api.xro/2.0/Payments` body carries the correct `Invoice.InvoiceID`, `Account.AccountID` (from `xero_bank_account_id`), `Amount`, `Reference` with tx hash suffix. Assert the mapper returns a correct `ERPBillPaymentResult`.
- **Boundary rule**: a compile-time test (or lint rule) asserting nothing outside `src/lib/erp/real/xero/` imports from that directory's internal files.

**Why real Postgres via Testcontainers and not an in-memory fake**: tighter realism, catches migration issues, and the refresh-race + reload-before-refresh tests require real transactional semantics that an in-memory fake would have to hand-simulate incorrectly. Setup cost is one-time (the helper file) and PR-time overhead is ~5–10s per test run for container startup, amortized across the full suite.

### Layer 3 — Live tests against the Demo Company (manual + nightly cron)

Lives in `tests/xero-live/` with its own Vitest config. Ignored by the default `npm test`. Invoked via:

- **Locally**: `npm run test:xero:live`. Requires a `.env.xero-live` file with a real Client ID, Client Secret, and a bootstrap refresh token obtained by running the OAuth flow once manually.
- **GitHub Actions**:
  - A manually-triggered workflow (`workflow_dispatch`).
  - A nightly cron at 04:00 UTC.
  - Credentials come from GitHub Actions secrets for Client ID + Client Secret.
  - The **refresh token** is stored in a dedicated Supabase row `xero_ci_bootstrap` (not as a GitHub secret, because GitHub secrets can't be rewritten from inside a workflow without a PAT). Every live run reads the current refresh token from that row, runs the tests (which rotate the token), and writes the new refresh token back to the row at the end of the suite. The GitHub Actions secret is only the seed for the very first run.
  - On failure, the job opens a GitHub issue labeled `xero-live-test-failure` via `gh issue create` and pings the existing notification channel.

Covers:
- **Wire-shape contract**: every endpoint we consume is hit once against the real Demo Company and response bodies are piped through our Zod schemas. A Xero field rename or removal fails this suite and surfaces as a GitHub issue within 24 hours.
- **OAuth flow**: refresh the bootstrap refresh token against `identity.xero.com`, assert the returned access token works on a live `GET /Contacts`. Catches Xero OAuth shape / error-code changes.
- **`fetchVendors` + `fetchInvoices`**: run once each against the Demo Company.
- **`recordBillPayment`**: write a $1 USD payment against a dedicated test bill (to contact `VANTOR_INTEGRATION_TEST`). No in-test cleanup — Xero's Demo Company auto-resets every 28 days.

### Fixture recording workflow

`scripts/xero-record-fixtures.ts`, invoked via `npm run xero:record`:

1. Reads live Xero credentials from `.env.xero-live`.
2. Hits every endpoint consumed by the adapter against the Demo Company.
3. Writes sanitized JSON to `tests/fixtures/xero/` — strips real tenant IDs, replaces them with `test-tenant-id`; strips any incidental PII.
4. Prints a diff vs. the previous fixtures so a reviewer can see whether Xero's wire shape shifted.

Run manually before each release, after any live-test `ERP_XERO_VALIDATION`, and whenever a new endpoint is added to the adapter. Fixtures are committed to the repo.

### Not in the test plan

- Load tests — rate limits would punish us and there's no MVP QPS target.
- Chaos / network fault injection — MSW-driven failure scenarios cover realistic failure modes.
- Property-based / fuzz tests on Zod schemas — schemas are small and documentation-bound.

## Open questions resolved during brainstorming

1. **"Do operators issue payments from Vantor or from the ERP?"** — From Vantor, for crypto-denominated AP. The ERP is the AP source of truth; Vantor is the payment rail. Vantor writes back to close the loop. This is why the write path is `recordBillPayment` (Xero Payments API), not `postGLEntry` (Xero Manual Journals API).
2. **Hybrid test strategy** — Layers 1+2 on every PR, Layer 3 manual + nightly cron. Live `recordBillPayment` tests rely on Demo Company 28-day reset for cleanup.
3. **Auto-pick first tenant** on connect; picker UI deferred.
4. **Scopes**: `offline_access accounting.contacts.read accounting.transactions accounting.journals`. `accounting.transactions` covers both Invoices (read) and Payments (write).
5. **In-process mutex + reload-before-refresh** rather than Postgres advisory locks for the refresh race. Advisory locks deferred until logs show they're needed.
6. **AES-256-GCM credential encryption** is a hard dependency from a separate spec, not part of this slice.
7. **`invalid_grant` shows "Reconnect" in the UI** and nothing else. No email, no automatic retry.
8. **Persist tokens before retrying the API call**, not after. Correct DB state is worth more than a saved request.

## Deferred (explicitly not in this slice)

- Generic GL journal posting (Manual Journals).
- Tenant picker UI for multi-org users.
- Bank-account picker UI.
- Background token-refresh worker for dormant connections (60-day expiry).
- Postgres advisory locks for cross-lambda refresh mutual exclusion.
- Email alerts on `ERP_XERO_AUTH_EXPIRED`.
- Automatic retry of 429-rate-limited requests.
- Partial-success handling for bulk endpoints.
- Bank reconciliation between Xero and on-chain state.
- Real SAP / Oracle / NetSuite adapters — they stay mocked; only their `postGLEntry` → `recordBillPayment` method signature is updated to keep the contract consistent.
