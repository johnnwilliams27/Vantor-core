# Xero Real Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock XeroMockAdapter with a production-grade XeroRealAdapter that talks to the real Xero API via OAuth 2.0, reading vendors and bills into Vantor's obligation pipeline and writing back bill payments to close the AP loop after Vantor executes stablecoin transfers on-chain.

**Architecture:** Hand-rolled `fetch`-based client (~250 LOC) with Zod-validated responses, per-connection in-process refresh mutex plus reload-before-refresh optimistic concurrency for the rotating-refresh-token race, Testcontainers Postgres for Layer 2 integration tests, MSW fixture replay for fast PR tests, and a separate Layer 3 live suite against Xero's Demo Company gated on `XERO_LIVE_TESTS=1`.

**Tech Stack:** TypeScript, Next.js 14 App Router, Supabase (Postgres + auth), Zod, Vitest, MSW (new dev dep), Testcontainers for Node (new dev dep), GitHub Actions, Xero API v2 (OAuth 2.0 + PKCE).

**Spec:** `docs/superpowers/specs/2026-04-11-xero-real-adapter-design.md`

**Hard dependency:** AES-256-GCM credential encryption — **LANDED on master**. `src/lib/crypto/envelope.ts` exports async `encryptJson`/`decryptJson`; `src/lib/erp/factory.ts` wraps them as `async encryptCredentials`/`async decryptCredentials`.

**Working directory:** All work happens inside the `.worktrees/xero-real-adapter` worktree on branch `feature/xero-real-adapter`. Never run `git add` from the main checkout.

---

## Patch log — 2026-04-13 (post-rebase)

The original plan (committed 2026-04-11) was authored against a pre-policy-engine master. The branch was rebased onto `6847c56` on 2026-04-13; the following inline edits were applied to keep the plan executable:

1. **Hard dependency** — no longer a blocker (encryption landed). Phase 0 Task 0.1 Step 3 rewritten to verify the envelope module exists, not to grep for `aes-256-gcm` in `factory.ts`.
2. **5 mock adapters, not 4** — `QuickBooksMockAdapter` was added on master (migration 0046 added `'quickbooks'` to the `erp_provider` enum). Task 1.2 updated to cover all 5.
3. **Migration number 0053, not 0038** — master is at 0052. Task 1.5 filename + commit message updated.
4. **Migration tool `npx tsx scripts/migrate.ts`, not `supabase db push`** — matches `CLAUDE.md`. Task 1.5 Steps 2–3 rewritten.
5. **`npm run db:types` does not exist** — Task 1.5 Step 4 rewritten to update `src/types/database.ts` manually.
6. **`encryptCredentials` is now async** — Phase 8 Task 8.2 callback must `await encryptCredentials(...)`. Plan line ~3044 patched.
7. **Policy-gate integration NOT required for `recordBillPayment`** — MovementKind in `src/lib/policy/types/movement.ts` has 7 kinds, none map to ERP ledger writes. `recordBillPayment` is a post-settlement ledger entry (money already moved, `externalTxHash` is a past-tense reference), not a gated money movement. No change needed.
8. **`.env.local` lives in the main checkout, not the worktree** — Phase 0 Task 0.1 Steps 4–5 rewritten to read from the parent `C:/Users/John/crypto-treasury/.env.local`. `XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`/`XERO_REDIRECT_URI` are **not yet set**; this blocks Phase 8 (OAuth routes) but not Phase 1–7.
9. **Task 3.1 swapped from Testcontainers to pglite** — Docker Desktop is not available on this machine. `@electric-sql/pglite@^0.4.4` is used instead: real Postgres compiled to WASM, in-process, zero daemon. Helper lives at `tests/helpers/pglite-postgres.ts` (not `testcontainers-postgres.ts`) but preserves the same `startTestPostgres()` interface so future tests can switch backends by changing the import path. The bootstrap schema is hand-rolled for the xero adapter's needs rather than replaying all 53 supabase migrations — pglite lacks Supabase-specific bits (realtime, pgsodium, `auth.uid()`) and replaying everything would fail. `testcontainers`/`pg`/`@types/pg` remain installed from Phase 2 but are currently unused; leave for now, consider a cleanup pass after Phase 10.
10. **Phase 8 scopes swapped to granular (post-2026-03-02 Xero migration)** — new Xero apps created after 2026-03-02 cannot use the deprecated broad `accounting.transactions` / `.transactions.read` scopes. Requests including them return `unauthorized_client — Invalid scope for client`. Task 8.1's authorize route now requests: `openid profile email offline_access accounting.contacts.read accounting.invoices.read accounting.payments accounting.settings.read`. Discovered 2026-04-13 while smoke-testing the end-to-end OAuth flow; bisected via `openid profile email offline_access + accounting.contacts.read` (works) → `+ accounting.transactions.read` (fails) → `+ accounting.invoices.read` (works). `accounting.payments` is the new granular write scope that covers POST /Payments for `recordBillPayment`. OIDC scopes (`openid profile email`) must be paired with the accounting scopes — Xero rejects accounting-only requests at the consent screen.

---

## Phase 0 — Preflight

### Task 0.1: Verify prerequisites and starting state

**Files:** None (verification only)

- [ ] **Step 1: Confirm you are in the worktree, not the main checkout**

Run: `pwd`
Expected: path contains `.worktrees/xero-real-adapter`. If not, abort — you're about to break worktree discipline.

- [ ] **Step 2: Confirm branch and clean state**

Run: `git status && git branch --show-current`
Expected: on `feature/xero-real-adapter`, no uncommitted changes except possibly `tsconfig.tsbuildinfo`.

- [ ] **Step 3: Verify encryption dependency is landed**

Run: `ls src/lib/crypto/envelope.ts src/lib/crypto/provider.ts && grep -n "encryptJson\\|decryptJson" src/lib/erp/factory.ts`
Expected: both files exist; `factory.ts` shows `encryptCredentials` / `decryptCredentials` delegating to `encryptJson` / `decryptJson`.

- [ ] **Step 4: Confirm `CREDENTIALS_ENCRYPTION_KEY` is set in the main checkout's `.env.local`**

Run: `grep -c CREDENTIALS_ENCRYPTION_KEY ../../.env.local`
Expected: `1` or higher. (The worktree has no `.env.local` of its own; Next.js reads from the parent checkout when run here, so the file at `C:/Users/John/crypto-treasury/.env.local` is the source of truth.)

- [ ] **Step 5: Xero OAuth env vars — deferred to Phase 8**

Run: `grep -cE '^XERO_(CLIENT_ID|CLIENT_SECRET|REDIRECT_URI)=' ../../.env.local`
If the count is `3`, great. If it is `0`, that is expected at this point — `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` / `XERO_REDIRECT_URI` are only required for Phase 8 (OAuth routes + connect UI) and Phase 9 (live Demo Company tests). Phase 1–7 work without them.

Before starting Phase 8, stop and have the user add these three vars to `../../.env.local` using dev credentials from their Xero developer account.

- [ ] **Step 6: Confirm Vitest, Zod, and Next.js versions**

Run: `node -p "require('./package.json').dependencies.zod" && node -p "require('./package.json').devDependencies.vitest"`
Expected: zod `^3.x`, vitest `^2.x`.

---

## Phase 1 — Contract change + dormant GL-post cleanup

Everything in this phase produces a green build with mocks still in place. After Phase 1 ships, the repo compiles, all existing tests pass, `postGLEntry` no longer exists anywhere, and the new `bill_payments` table replaces the dropped `gl_postings` table. The real Xero adapter does not exist yet.

### Task 1.1: Update `IERPAdapter` interface and payload types

**Files:**
- Modify: `src/types/erp.ts`

- [ ] **Step 1: Replace the GL-post types with bill-payment types**

Replace lines 31–52 with:

```ts
export interface ERPBillPaymentPayload {
  /** ERP-side invoice/bill ID (not a Vantor UUID). */
  invoiceId: string;
  /** Amount paid, in the invoice's currency. */
  amount: number;
  /** ISO 4217 currency code. */
  currency: string;
  /** ISO yyyy-mm-dd. */
  paymentDate: string;
  /** Free-text reference, e.g. 'Vantor-USDC'. */
  reference: string;
  /** On-chain transaction hash Vantor paid from. */
  externalTxHash: string;
}

export interface ERPBillPaymentResult {
  /** ERP-side payment ID. */
  externalPaymentId: string;
  status: 'recorded';
  message?: string;
}

export interface IERPAdapter {
  provider: string;
  testConnection(): Promise<{ success: boolean; message: string }>;
  fetchVendors(): Promise<ERPVendorRaw[]>;
  fetchInvoices(): Promise<ERPInvoiceRaw[]>;
  recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult>;
}
```

- [ ] **Step 2: Run the type check to see the blast radius**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: errors in `src/lib/erp/mock/*.ts` and `src/app/api/erp/gl-post/route.ts` referencing the now-missing `postGLEntry` / `ERPGLPostPayload` / `ERPGLPostResult` — this is the driver list for the next tasks.

- [ ] **Step 3: Do not commit yet**

Phase 1 commits as one unit after all contract-consuming files are updated.

### Task 1.2: Update all five mock adapters to implement `recordBillPayment`

**Files:**
- Modify: `src/lib/erp/mock/xero-mock.ts`
- Modify: `src/lib/erp/mock/sap-mock.ts`
- Modify: `src/lib/erp/mock/oracle-mock.ts`
- Modify: `src/lib/erp/mock/netsuite-mock.ts`
- Modify: `src/lib/erp/mock/quickbooks-mock.ts`

- [ ] **Step 1: Update `xero-mock.ts` imports and method**

In `src/lib/erp/mock/xero-mock.ts`, replace the imports block and the `postGLEntry` method.

Imports (lines 1–8):
```ts
import type {
  IERPAdapter,
  ERPCredentials,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentPayload,
  ERPBillPaymentResult,
} from '@/types/erp';
```

Replace the existing `postGLEntry` method (lines 90–97) with:
```ts
async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
  await delay(400);
  return {
    externalPaymentId: `XERO-PMT-${Date.now()}`,
    status: 'recorded',
    message: `Payment of ${payload.amount} ${payload.currency} recorded against Xero bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
  };
}
```

- [ ] **Step 2: Apply the same contract update to `sap-mock.ts`**

Same import change. Replace `postGLEntry` with:
```ts
async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
  await delay(400);
  return {
    externalPaymentId: `SAP-PMT-${Date.now()}`,
    status: 'recorded',
    message: `Payment of ${payload.amount} ${payload.currency} recorded against SAP bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
  };
}
```

- [ ] **Step 3: Apply the same contract update to `oracle-mock.ts`**

Same import change. Replace `postGLEntry` with:
```ts
async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
  await delay(400);
  return {
    externalPaymentId: `ORC-PMT-${Date.now()}`,
    status: 'recorded',
    message: `Payment of ${payload.amount} ${payload.currency} recorded against Oracle bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
  };
}
```

- [ ] **Step 4: Apply the same contract update to `netsuite-mock.ts`**

Same import change. Replace `postGLEntry` with:
```ts
async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
  await delay(400);
  return {
    externalPaymentId: `NS-PMT-${Date.now()}`,
    status: 'recorded',
    message: `Payment of ${payload.amount} ${payload.currency} recorded against NetSuite bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
  };
}
```

- [ ] **Step 5: Apply the same contract update to `quickbooks-mock.ts`**

Same import change. Replace `postGLEntry` with:
```ts
async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
  await delay(400);
  return {
    externalPaymentId: `QB-PMT-${Date.now()}`,
    status: 'recorded',
    message: `Payment of ${payload.amount} ${payload.currency} recorded against QuickBooks bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
  };
}
```

- [ ] **Step 6: Re-run the type check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: mock adapter errors gone. Remaining errors should only be in `src/app/api/erp/gl-post/route.ts` and possibly `src/lib/test-mode/seed/erp.ts` / `wipe.ts`.

### Task 1.3: Delete dormant `/api/erp/gl-post` route

**Files:**
- Delete: `src/app/api/erp/gl-post/route.ts`

- [ ] **Step 1: Delete the route file**

Run: `rm src/app/api/erp/gl-post/route.ts && rmdir src/app/api/erp/gl-post 2>/dev/null || true`

- [ ] **Step 2: Confirm nothing else references the route**

Run: `grep -rn "api/erp/gl-post\|/erp/gl-post" src/ tests/ scripts/ || echo "no refs"`
Expected: `no refs`.

- [ ] **Step 3: Re-run the type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: `gl-post/route.ts` errors gone. Remaining errors (if any) are in test-mode seed helpers — handled next.

### Task 1.4: Update test-mode seed helpers to target `bill_payments`

**Files:**
- Modify: `src/lib/test-mode/seed/erp.ts`
- Modify: `src/lib/test-mode/seed/wipe.ts`

- [ ] **Step 1: Read the current seed helper**

Run: `grep -n "gl_postings\|postGLEntry" src/lib/test-mode/seed/erp.ts src/lib/test-mode/seed/wipe.ts`
Record the matched lines — they need to be updated or deleted.

- [ ] **Step 2: In `erp.ts`, replace `gl_postings` inserts with `bill_payments` inserts**

Find any block that inserts into `gl_postings` and replace with the equivalent insert into `bill_payments`, adapting the column names:

```ts
// Before:
// await supabase.from('gl_postings').insert({
//   user_id, enterprise_id, erp_config_id, invoice_id, payment_id,
//   external_gl_id, amount, token, gl_account, status, response_data,
// });

// After:
await supabase.from('bill_payments').insert({
  user_id,
  enterprise_id,
  erp_config_id,
  invoice_id: `SEED-BILL-${i}`,        // string, not UUID
  external_payment_id: `SEED-PMT-${i}`,
  external_tx_hash: `0xseed${i.toString().padStart(60, '0')}`,
  amount,
  currency: 'USD',
  payment_date: new Date().toISOString().slice(0, 10),
  reference: `seed-${i}`,
  status: 'recorded',
  response_data: { seeded: true },
});
```

Drop the `token` column reference — `bill_payments` uses `currency` instead.

- [ ] **Step 3: In `wipe.ts`, replace `gl_postings` truncation with `bill_payments` truncation**

Find the `gl_postings` reference and replace with `bill_payments`:

```ts
// Before: await supabase.from('gl_postings').delete().eq('user_id', userId);
// After:
await supabase.from('bill_payments').delete().eq('user_id', userId);
```

- [ ] **Step 4: Re-run the type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no errors. If there are any, they're the remaining contract-consumers and should be fixed the same way.

### Task 1.5: Supabase migration — drop `gl_postings`, create `bill_payments`, add Xero columns

**Files:**
- Create: `supabase/migrations/0053_xero_adapter.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0053_xero_adapter.sql`:

```sql
-- 0053_xero_adapter.sql
-- Xero real adapter: drop dormant gl_postings, create bill_payments,
-- add Xero-specific columns to erp_configurations.

-- Drop dormant gl_postings table (and its indexes/policies).
DROP TABLE IF EXISTS gl_postings CASCADE;

-- Add Xero-specific columns to erp_configurations.
ALTER TABLE erp_configurations
  ADD COLUMN IF NOT EXISTS xero_tenant_id             TEXT,
  ADD COLUMN IF NOT EXISTS xero_bank_account_id       TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refresh_token_rotated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status                     TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'needs_reconnect'));

CREATE INDEX IF NOT EXISTS idx_erp_configurations_status
  ON erp_configurations(status)
  WHERE status != 'active';

-- New bill_payments table replacing gl_postings.
CREATE TABLE bill_payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id        UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  erp_config_id        UUID NOT NULL REFERENCES erp_configurations(id) ON DELETE CASCADE,
  invoice_id           TEXT NOT NULL,             -- ERP-side, not a Vantor UUID
  external_payment_id  TEXT,                      -- ERP-side payment ID
  external_tx_hash     TEXT NOT NULL,             -- on-chain tx hash
  amount               NUMERIC(36, 6) NOT NULL,
  currency             TEXT NOT NULL,             -- ISO 4217
  payment_date         DATE NOT NULL,
  reference            TEXT,
  status               TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'failed')),
  response_data        JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bill_payments_user         ON bill_payments(user_id);
CREATE INDEX idx_bill_payments_enterprise   ON bill_payments(enterprise_id);
CREATE INDEX idx_bill_payments_erp_config   ON bill_payments(erp_config_id);
CREATE INDEX idx_bill_payments_tx_hash      ON bill_payments(external_tx_hash);

-- RLS: mirror the erp_configurations policies (user + enterprise scoping).
ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY bill_payments_user_read
  ON bill_payments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY bill_payments_user_insert
  ON bill_payments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY bill_payments_user_update
  ON bill_payments FOR UPDATE
  USING (user_id = auth.uid());

-- Table for CI live test refresh token bootstrap (see Phase 9).
CREATE TABLE xero_ci_bootstrap (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  refresh_token  TEXT NOT NULL,
  rotated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT xero_ci_bootstrap_singleton CHECK (id = 1)
);
```

- [ ] **Step 2: Apply the migration to the dev Supabase project**

Per `CLAUDE.md`, the project uses `scripts/migrate.ts`, not `supabase db push`. `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` selects which project the script targets — set it to the dev project ref (`spllxotyxipdvfpkkvgu`) before running.

Run: `npx tsx scripts/migrate.ts supabase/migrations/0053_xero_adapter.sql`

Expected: migration applies without error and writes a tracker row to `supabase_migrations.schema_migrations`. If it errors on `DROP TABLE gl_postings` because of a foreign key from an unrelated table, investigate — do NOT add extra CASCADE without understanding what would break.

- [ ] **Step 3: Apply the migration to prod Supabase**

Swap `NEXT_PUBLIC_SUPABASE_URL` to the prod project ref (`lfujbwemavgiifkltrag`), then rerun the same `scripts/migrate.ts` command. Restore dev URL afterwards.

Both Supabase projects must be migrated together per the project's Supabase invariant. If one succeeds and the other fails, rerun the failing one — the additive parts are idempotent (`IF NOT EXISTS`) and the `DROP TABLE` is a no-op the second time.

- [ ] **Step 4: Update hand-maintained database types**

There is no `npm run db:types` script — `src/types/database.ts` is maintained by hand. Manually edit it to:
- Remove the `gl_postings` Row/Insert/Update types and its entry in the `Tables` map.
- Add `bill_payments` Row/Insert/Update types + entry in the `Tables` map, matching the columns in the migration.
- Add the five new columns to `erp_configurations` Row/Insert/Update: `xero_tenant_id: string | null`, `xero_bank_account_id: string | null`, `access_token_expires_at: string | null`, `refresh_token_rotated_at: string | null`, `status: 'active' | 'expired' | 'needs_reconnect'` (not-null, default `'active'`).
- Add `xero_ci_bootstrap` Row/Insert/Update + entry in the `Tables` map.

- [ ] **Step 5: Re-run the type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no errors.

### Task 1.6: Run existing tests and commit Phase 1

**Files:** None (verification + commit)

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all existing tests pass. None of them touched `postGLEntry` directly.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit Phase 1 as one unit**

Run:
```bash
git add src/types/erp.ts src/lib/erp/mock/ src/lib/test-mode/seed/ supabase/migrations/0053_xero_adapter.sql src/types/database.ts
git rm src/app/api/erp/gl-post/route.ts
git commit -m "$(cat <<'EOF'
refactor(erp): replace postGLEntry with recordBillPayment across adapter contract

Xero's write path for treasury-driven AP is Payments (applied to Invoices),
not Manual Journals — Manual Journals bypass the AP subledger, leaving
bills showing unpaid. This commit updates the shared IERPAdapter contract
to recordBillPayment, propagates the change through all four mock
adapters, and removes the dormant /api/erp/gl-post route (never wired
to any UI) along with its gl_postings table.

Adds erp_configurations columns (xero_tenant_id, xero_bank_account_id,
access_token_expires_at, refresh_token_rotated_at, status) and a new
bill_payments table. Applied to dev + prod Supabase.

Contract change; no real Xero adapter yet. Phase 1 of the Xero real-
adapter rollout — see docs/superpowers/plans/2026-04-11-xero-real-adapter.md.
EOF
)"
```

---

## Phase 2 — Dev dependencies for test infrastructure

### Task 2.1: Install MSW and Testcontainers

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install MSW**

Run: `npm install --save-dev msw@^2.6.0`
Expected: installs without peer-dep warnings. MSW 2.x is the correct major version for Node 20 + Vitest 2.

- [ ] **Step 2: Install Testcontainers for Node**

Run: `npm install --save-dev testcontainers@^10.13.0 pg @types/pg`
Expected: installs `testcontainers`, `pg`, and `@types/pg`. Testcontainers needs Docker running on the host — document this in the test-infra task below.

- [ ] **Step 3: Commit the dep change**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add msw and testcontainers for Xero adapter test infra"
```

---

## Phase 3 — Test infrastructure

Everything in this phase is plumbing used by later tasks. It has its own small tests to prove the plumbing works, but does not yet exercise any Xero code.

### Task 3.1: Testcontainers Postgres helper

**Files:**
- Create: `tests/helpers/testcontainers-postgres.ts`
- Create: `tests/helpers/testcontainers-postgres.test.ts`

- [ ] **Step 1: Write the helper**

Create `tests/helpers/testcontainers-postgres.ts`:

```ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TestDb {
  container: StartedPostgreSqlContainer;
  client: Client;
  url: string;
  stop(): Promise<void>;
}

/**
 * Start a throwaway Postgres container, run all supabase migrations against
 * it, and return a connected pg client plus a stop() helper. Callers should
 * stop the container in an afterAll() hook.
 */
export async function startTestPostgres(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('vantor_test')
    .withUsername('vantor')
    .withPassword('vantor')
    .start();

  const url = container.getConnectionUri();
  const client = new Client({ connectionString: url });
  await client.connect();

  // Apply all supabase migrations in numeric order.
  // We only apply ones that are safe for a non-Supabase vanilla Postgres —
  // namely, we skip anything that references auth.users or auth schemas,
  // and we shim auth.uid() as a no-op function.
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;
  `);

  const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    try {
      await client.query(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed in Testcontainers: ${(err as Error).message}`);
    }
  }

  return {
    container,
    client,
    url,
    async stop() {
      await client.end();
      await container.stop();
    },
  };
}
```

- [ ] **Step 2: Add `@testcontainers/postgresql` if not already present**

Run: `npm ls @testcontainers/postgresql 2>&1 | head -5`
If "not found", run: `npm install --save-dev @testcontainers/postgresql@^10.13.0`

- [ ] **Step 3: Write a smoke test for the helper**

Create `tests/helpers/testcontainers-postgres.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestPostgres, type TestDb } from './testcontainers-postgres';

describe('startTestPostgres', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await startTestPostgres();
  }, 120_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it('applies migrations and creates erp_configurations', async () => {
    const res = await db.client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'erp_configurations' AND column_name = 'xero_tenant_id'
    `);
    expect(res.rowCount).toBe(1);
  });

  it('creates bill_payments with the right columns', async () => {
    const res = await db.client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'bill_payments'
      ORDER BY ordinal_position
    `);
    const names = res.rows.map((r) => r.column_name);
    expect(names).toContain('external_tx_hash');
    expect(names).toContain('invoice_id');
    expect(names).toContain('currency');
  });

  it('drops the gl_postings table', async () => {
    const res = await db.client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'gl_postings'
    `);
    expect(res.rowCount).toBe(0);
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npm test -- --run tests/helpers/testcontainers-postgres.test.ts`
Expected: PASS. First run pulls the `postgres:16-alpine` image (takes ~30s), subsequent runs are faster. Requires Docker running locally.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/testcontainers-postgres.ts tests/helpers/testcontainers-postgres.test.ts package.json package-lock.json
git commit -m "test(infra): testcontainers-postgres helper with migration bootstrap"
```

### Task 3.2: MSW server helper + fixture loader

**Files:**
- Create: `tests/helpers/msw-xero.ts`
- Create: `tests/fixtures/xero/.gitkeep`
- Create: `tests/fixtures/xero/connections.json`
- Create: `tests/fixtures/xero/contacts.json`
- Create: `tests/fixtures/xero/invoices.json`
- Create: `tests/fixtures/xero/accounts-bank.json`
- Create: `tests/fixtures/xero/payment.json`
- Create: `tests/fixtures/xero/token-refresh.json`

- [ ] **Step 1: Write initial hand-crafted fixtures from Xero docs**

Create `tests/fixtures/xero/connections.json`:
```json
{
  "response": [
    {
      "id": "a1234567-0000-0000-0000-000000000001",
      "tenantId": "tenant-test-0001",
      "tenantType": "ORGANISATION",
      "tenantName": "Demo Company (Global)",
      "createdDateUtc": "2025-01-01T00:00:00Z",
      "updatedDateUtc": "2025-01-01T00:00:00Z"
    }
  ]
}
```

Create `tests/fixtures/xero/contacts.json`:
```json
{
  "Id": "req-contacts-0001",
  "Status": "OK",
  "ProviderName": "Xero API Partner",
  "DateTimeUTC": "/Date(1704067200000)/",
  "Contacts": [
    {
      "ContactID": "c0000001-0000-0000-0000-000000000001",
      "Name": "Apex Consulting",
      "EmailAddress": "accounts@apexconsulting.co",
      "IsSupplier": true,
      "IsCustomer": false
    },
    {
      "ContactID": "c0000001-0000-0000-0000-000000000002",
      "Name": "Meridian Supplies",
      "EmailAddress": "billing@meridiansupplies.com",
      "IsSupplier": true,
      "IsCustomer": false
    }
  ]
}
```

Create `tests/fixtures/xero/invoices.json`:
```json
{
  "Id": "req-invoices-0001",
  "Status": "OK",
  "ProviderName": "Xero API Partner",
  "DateTimeUTC": "/Date(1704067200000)/",
  "Invoices": [
    {
      "InvoiceID": "i0000001-0000-0000-0000-000000000001",
      "InvoiceNumber": "XERO-2025-001",
      "Type": "ACCPAY",
      "Contact": { "ContactID": "c0000001-0000-0000-0000-000000000001" },
      "Date": "2025-04-01",
      "DueDate": "2025-05-01",
      "Status": "AUTHORISED",
      "LineAmountTypes": "Exclusive",
      "SubTotal": 12500.00,
      "TotalTax": 0.00,
      "Total": 12500.00,
      "AmountDue": 12500.00,
      "AmountPaid": 0.00,
      "CurrencyCode": "USD"
    }
  ]
}
```

Create `tests/fixtures/xero/accounts-bank.json`:
```json
{
  "Id": "req-accounts-0001",
  "Status": "OK",
  "Accounts": [
    {
      "AccountID": "a0000001-0000-0000-0000-000000000001",
      "Code": "090",
      "Name": "Business Bank Account",
      "Type": "BANK",
      "Status": "ACTIVE",
      "CurrencyCode": "USD"
    }
  ]
}
```

Create `tests/fixtures/xero/payment.json`:
```json
{
  "Id": "req-payment-0001",
  "Status": "OK",
  "Payments": [
    {
      "PaymentID": "p0000001-0000-0000-0000-000000000001",
      "Date": "2025-04-10",
      "Amount": 12500.00,
      "CurrencyRate": 1.0,
      "Reference": "Vantor-USDC tx:0xabcdef",
      "Status": "AUTHORISED",
      "PaymentType": "ACCPAYPAYMENT",
      "Invoice": { "InvoiceID": "i0000001-0000-0000-0000-000000000001" },
      "Account": { "AccountID": "a0000001-0000-0000-0000-000000000001" }
    }
  ]
}
```

Create `tests/fixtures/xero/token-refresh.json`:
```json
{
  "access_token": "new-access-token-rotated",
  "refresh_token": "new-refresh-token-rotated",
  "expires_in": 1800,
  "token_type": "Bearer",
  "scope": "offline_access accounting.contacts.read accounting.transactions accounting.journals"
}
```

- [ ] **Step 2: Write the MSW helper**

Create `tests/helpers/msw-xero.ts`:

```ts
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'xero');

export function loadFixture<T = unknown>(name: string): T {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(raw) as T;
}

export interface XeroMswOptions {
  /** Override the /connect/token response (e.g., to return invalid_grant). */
  tokenResponse?: { status: number; body: unknown };
  /** Override the /Contacts response. */
  contactsResponse?: { status: number; body: unknown };
  /** Override the /Invoices response. */
  invoicesResponse?: { status: number; body: unknown };
  /** Override the /Payments POST response. */
  paymentsResponse?: { status: number; body: unknown };
  /** Override the /connections response. */
  connectionsResponse?: { status: number; body: unknown };
  /** Override the /Accounts response. */
  accountsResponse?: { status: number; body: unknown };
  /** Called on every matched handler so tests can assert call counts. */
  onCall?: (endpoint: string) => void;
}

export function makeXeroMswServer(options: XeroMswOptions = {}) {
  const token = options.tokenResponse ?? { status: 200, body: loadFixture('token-refresh') };
  const contacts = options.contactsResponse ?? { status: 200, body: loadFixture('contacts') };
  const invoices = options.invoicesResponse ?? { status: 200, body: loadFixture('invoices') };
  const payments = options.paymentsResponse ?? { status: 200, body: loadFixture('payment') };
  const connections = options.connectionsResponse ?? { status: 200, body: loadFixture('connections').response };
  const accounts = options.accountsResponse ?? { status: 200, body: loadFixture('accounts-bank') };

  return setupServer(
    http.post('https://identity.xero.com/connect/token', () => {
      options.onCall?.('/connect/token');
      return HttpResponse.json(token.body, { status: token.status });
    }),
    http.get('https://api.xero.com/connections', () => {
      options.onCall?.('/connections');
      return HttpResponse.json(connections.body, { status: connections.status });
    }),
    http.get('https://api.xero.com/api.xro/2.0/Contacts', () => {
      options.onCall?.('/Contacts');
      return HttpResponse.json(contacts.body, { status: contacts.status });
    }),
    http.get('https://api.xero.com/api.xro/2.0/Invoices', () => {
      options.onCall?.('/Invoices');
      return HttpResponse.json(invoices.body, { status: invoices.status });
    }),
    http.get('https://api.xero.com/api.xro/2.0/Accounts', () => {
      options.onCall?.('/Accounts');
      return HttpResponse.json(accounts.body, { status: accounts.status });
    }),
    http.post('https://api.xero.com/api.xro/2.0/Payments', () => {
      options.onCall?.('/Payments');
      return HttpResponse.json(payments.body, { status: payments.status });
    }),
  );
}
```

- [ ] **Step 3: Smoke-test the MSW helper**

Create `tests/helpers/msw-xero.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeXeroMswServer, loadFixture } from './msw-xero';

describe('makeXeroMswServer', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('intercepts /connections', async () => {
    const res = await fetch('https://api.xero.com/connections', {
      headers: { Authorization: 'Bearer x' },
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].tenantId).toBe('tenant-test-0001');
  });

  it('loadFixture returns parsed JSON', () => {
    const contacts = loadFixture<{ Contacts: unknown[] }>('contacts');
    expect(contacts.Contacts.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npm test -- --run tests/helpers/msw-xero.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/msw-xero.ts tests/helpers/msw-xero.test.ts tests/fixtures/xero/
git commit -m "test(infra): MSW helper + hand-crafted Xero fixtures"
```

---

## Phase 4 — Pure adapter modules (errors, schemas, mapper)

These three files have no runtime dependencies on test infrastructure and land first.

### Task 4.1: `errors.ts` — XeroError factory with all 8 reason codes

**Files:**
- Create: `src/lib/erp/real/xero/errors.ts`
- Create: `tests/xero/errors.test.ts`

- [ ] **Step 1: Read the Vantor error contract**

Run: `grep -rn "reason_code\|VantorError" src/lib/errors/ | head -20`
Find and read the existing `VantorError` class. Use its constructor as the base for `XeroError`. If it doesn't exist, read `docs/superpowers/feedback/feedback_vantor_error_design.md` (if present) or use the shape documented in the spec.

- [ ] **Step 2: Write the failing test**

Create `tests/xero/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  xeroStateMismatch,
  xeroNotConnected,
  xeroAuthExpired,
  xeroRefreshPersistFailure,
  xeroRateLimited,
  xeroTenantUnknown,
  xeroUpstreamFailure,
  xeroValidation,
} from '@/lib/erp/real/xero/errors';

const baseFields = {
  connection_id: 'c-1',
  xero_tenant_id: 't-1',
  endpoint: '/api.xro/2.0/Contacts',
  trace_id: 'trace-1',
};

describe('XeroError factory', () => {
  it('xeroStateMismatch sets reason code and next step', () => {
    const err = xeroStateMismatch({ ...baseFields });
    expect(err.reason_code).toBe('ERP_XERO_STATE_MISMATCH');
    expect(err.next_step).toMatch(/restart the xero connection/i);
    expect(err.fields.connection_id).toBe('c-1');
  });

  it('xeroRateLimited carries retry_after_seconds', () => {
    const err = xeroRateLimited({ ...baseFields, retry_after_seconds: 30, daily_limit_remaining: 4000 });
    expect(err.reason_code).toBe('ERP_XERO_RATE_LIMITED');
    expect(err.fields.retry_after_seconds).toBe(30);
    expect(err.fields.daily_limit_remaining).toBe(4000);
  });

  it('xeroValidation carries zod issues and a truncated body', () => {
    const err = xeroValidation({
      ...baseFields,
      zod_issues: [{ path: ['Contacts'], message: 'Required' }],
      body_prefix: 'a'.repeat(500),
    });
    expect(err.reason_code).toBe('ERP_XERO_VALIDATION');
    expect((err.fields.body_prefix as string).length).toBeLessThanOrEqual(200);
    expect(err.fields.zod_issues).toHaveLength(1);
  });

  it('toUserFacing drops internal fields and keeps reason_code + next_step + trace_id', () => {
    const err = xeroUpstreamFailure({ ...baseFields });
    const user = err.toUserFacing();
    expect(user.reason_code).toBe('ERP_XERO_UPSTREAM_FAILURE');
    expect(user.next_step).toBeDefined();
    expect(user.trace_id).toBe('trace-1');
    expect((user as Record<string, unknown>).zod_issues).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/errors.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement `errors.ts`**

Create `src/lib/erp/real/xero/errors.ts`:

```ts
export type XeroReasonCode =
  | 'ERP_XERO_STATE_MISMATCH'
  | 'ERP_XERO_NOT_CONNECTED'
  | 'ERP_XERO_AUTH_EXPIRED'
  | 'ERP_XERO_REFRESH_PERSIST_FAILURE'
  | 'ERP_XERO_RATE_LIMITED'
  | 'ERP_XERO_TENANT_UNKNOWN'
  | 'ERP_XERO_UPSTREAM_FAILURE'
  | 'ERP_XERO_VALIDATION';

export interface XeroErrorFields {
  connection_id?: string;
  xero_tenant_id?: string;
  endpoint?: string;
  trace_id: string;
  [key: string]: unknown;
}

export interface XeroUserFacing {
  reason_code: XeroReasonCode;
  next_step: string;
  trace_id: string;
}

export class XeroError extends Error {
  readonly reason_code: XeroReasonCode;
  readonly explanation: string;
  readonly next_step: string;
  readonly fields: XeroErrorFields;

  constructor(
    reason_code: XeroReasonCode,
    explanation: string,
    next_step: string,
    fields: XeroErrorFields,
  ) {
    super(`[${reason_code}] ${explanation}`);
    this.name = 'XeroError';
    this.reason_code = reason_code;
    this.explanation = explanation;
    this.next_step = next_step;
    this.fields = fields;
  }

  /** Shape safe to return to the UI — no tokens, no raw Xero bodies. */
  toUserFacing(): XeroUserFacing {
    return {
      reason_code: this.reason_code,
      next_step: this.next_step,
      trace_id: this.fields.trace_id,
    };
  }
}

function truncate(body: string | undefined, max = 200): string | undefined {
  if (!body) return body;
  return body.length > max ? body.slice(0, max) : body;
}

export function xeroStateMismatch(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_STATE_MISMATCH',
    'OAuth state parameter did not match the signed cookie.',
    'Restart the Xero connection from Settings → ERP.',
    fields,
  );
}

export function xeroNotConnected(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_NOT_CONNECTED',
    'No active Xero connection for this user.',
    'Connect Xero from Settings → ERP.',
    fields,
  );
}

export function xeroAuthExpired(fields: XeroErrorFields & { refresh_token_rotated_at?: string }): XeroError {
  return new XeroError(
    'ERP_XERO_AUTH_EXPIRED',
    'The Xero refresh token is no longer valid.',
    'Reconnect Xero from Settings → ERP.',
    fields,
  );
}

export function xeroRefreshPersistFailure(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_REFRESH_PERSIST_FAILURE',
    'Xero refresh succeeded but the new token could not be saved to the database.',
    'Try the action again in a moment. If it keeps failing, contact support with this trace ID.',
    fields,
  );
}

export function xeroRateLimited(fields: XeroErrorFields & { retry_after_seconds: number; daily_limit_remaining?: number }): XeroError {
  return new XeroError(
    'ERP_XERO_RATE_LIMITED',
    'Xero rate-limited this connection.',
    `Xero is throttling this connection. Vantor will resume automatically in ${fields.retry_after_seconds} seconds.`,
    fields,
  );
}

export function xeroTenantUnknown(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_TENANT_UNKNOWN',
    'The stored Xero tenant ID is no longer present in /connections.',
    'This Xero connection was removed from the Xero side. Reconnect from Settings → ERP.',
    fields,
  );
}

export function xeroUpstreamFailure(fields: XeroErrorFields): XeroError {
  return new XeroError(
    'ERP_XERO_UPSTREAM_FAILURE',
    'Xero returned a server error or the request failed to reach Xero.',
    'Xero is having trouble right now. Try again in a moment.',
    fields,
  );
}

export function xeroValidation(fields: XeroErrorFields & { zod_issues: unknown[]; body_prefix?: string }): XeroError {
  return new XeroError(
    'ERP_XERO_VALIDATION',
    'A Xero response failed schema validation.',
    'Vantor needs to update its Xero integration. The engineering team has been notified with this trace ID.',
    { ...fields, body_prefix: truncate(fields.body_prefix) },
  );
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/errors.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/erp/real/xero/errors.ts tests/xero/errors.test.ts
git commit -m "feat(xero): XeroError factory with 8 reason codes + toUserFacing split"
```

### Task 4.2: `schemas.ts` — Zod schemas for Xero response shapes

**Files:**
- Create: `src/lib/erp/real/xero/schemas.ts`
- Create: `tests/xero/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TokenResponseSchema,
  ConnectionsResponseSchema,
  ContactsResponseSchema,
  InvoicesResponseSchema,
  AccountsResponseSchema,
  PaymentsResponseSchema,
} from '@/lib/erp/real/xero/schemas';
import { loadFixture } from '../helpers/msw-xero';

describe('Xero schemas', () => {
  it('parses token-refresh fixture', () => {
    const parsed = TokenResponseSchema.parse(loadFixture('token-refresh'));
    expect(parsed.access_token).toBeDefined();
    expect(parsed.refresh_token).toBeDefined();
    expect(parsed.expires_in).toBeGreaterThan(0);
  });

  it('parses connections fixture', () => {
    const raw = loadFixture<{ response: unknown }>('connections');
    const parsed = ConnectionsResponseSchema.parse(raw.response);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tenantType).toBe('ORGANISATION');
  });

  it('parses contacts fixture', () => {
    const parsed = ContactsResponseSchema.parse(loadFixture('contacts'));
    expect(parsed.Contacts.length).toBeGreaterThan(0);
    expect(parsed.Contacts[0].IsSupplier).toBe(true);
  });

  it('parses invoices fixture', () => {
    const parsed = InvoicesResponseSchema.parse(loadFixture('invoices'));
    expect(parsed.Invoices[0].Type).toBe('ACCPAY');
  });

  it('parses accounts-bank fixture', () => {
    const parsed = AccountsResponseSchema.parse(loadFixture('accounts-bank'));
    expect(parsed.Accounts[0].Type).toBe('BANK');
  });

  it('parses payment fixture', () => {
    const parsed = PaymentsResponseSchema.parse(loadFixture('payment'));
    expect(parsed.Payments[0].PaymentID).toBeDefined();
  });

  it('rejects a contacts response missing the Contacts array', () => {
    expect(() => ContactsResponseSchema.parse({ Status: 'OK' })).toThrow();
  });

  it('ignores unknown top-level fields on contacts', () => {
    const parsed = ContactsResponseSchema.parse({
      ...loadFixture('contacts'),
      SomeNewFieldXeroAdded: 42,
    });
    expect(parsed.Contacts.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/schemas.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `schemas.ts`**

Create `src/lib/erp/real/xero/schemas.ts`:

```ts
import { z } from 'zod';

// OAuth token response (both auth-code exchange and refresh).
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// /connections returns a bare array.
export const ConnectionsResponseSchema = z.array(
  z.object({
    id: z.string(),
    tenantId: z.string(),
    tenantType: z.enum(['ORGANISATION', 'PRACTICE']),
    tenantName: z.string(),
    createdDateUtc: z.string().optional(),
    updatedDateUtc: z.string().optional(),
  }),
);
export type ConnectionsResponse = z.infer<typeof ConnectionsResponseSchema>;

// Contacts (vendors on the AP side).
const ContactSchema = z.object({
  ContactID: z.string(),
  Name: z.string(),
  EmailAddress: z.string().optional(),
  IsSupplier: z.boolean().optional(),
  IsCustomer: z.boolean().optional(),
});

export const ContactsResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Contacts: z.array(ContactSchema),
});
export type ContactsResponse = z.infer<typeof ContactsResponseSchema>;

// Invoices (ACCPAY = bills we pay).
const InvoiceLineItemSchema = z.object({
  LineItemID: z.string().optional(),
  Description: z.string().optional(),
  LineAmount: z.number().optional(),
  AccountCode: z.string().optional(),
});

const InvoiceSchema = z.object({
  InvoiceID: z.string(),
  InvoiceNumber: z.string().optional(),
  Type: z.enum(['ACCPAY', 'ACCREC']),
  Contact: z.object({ ContactID: z.string() }),
  Date: z.string().optional(),
  DueDate: z.string().optional(),
  Status: z.string().optional(),
  LineAmountTypes: z.string().optional(),
  SubTotal: z.number().optional(),
  TotalTax: z.number().optional(),
  Total: z.number(),
  AmountDue: z.number().optional(),
  AmountPaid: z.number().optional(),
  CurrencyCode: z.string(),
  LineItems: z.array(InvoiceLineItemSchema).optional(),
});

export const InvoicesResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Invoices: z.array(InvoiceSchema),
});
export type InvoicesResponse = z.infer<typeof InvoicesResponseSchema>;

// Accounts (used to resolve bank account id).
const AccountSchema = z.object({
  AccountID: z.string(),
  Code: z.string().optional(),
  Name: z.string(),
  Type: z.string(),
  Status: z.string().optional(),
  CurrencyCode: z.string().optional(),
});

export const AccountsResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Accounts: z.array(AccountSchema),
});
export type AccountsResponse = z.infer<typeof AccountsResponseSchema>;

// Payment response (what /Payments POST returns).
const PaymentSchema = z.object({
  PaymentID: z.string(),
  Date: z.string().optional(),
  Amount: z.number(),
  CurrencyRate: z.number().optional(),
  Reference: z.string().optional(),
  Status: z.string().optional(),
  PaymentType: z.string().optional(),
  Invoice: z.object({ InvoiceID: z.string() }),
  Account: z.object({ AccountID: z.string() }),
});

export const PaymentsResponseSchema = z.object({
  Id: z.string().optional(),
  Status: z.string().optional(),
  Payments: z.array(PaymentSchema),
});
export type PaymentsResponse = z.infer<typeof PaymentsResponseSchema>;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/schemas.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/real/xero/schemas.ts tests/xero/schemas.test.ts
git commit -m "feat(xero): Zod schemas for Xero API responses"
```

### Task 4.3: `mapper.ts` — Xero shapes → Vantor shapes

**Files:**
- Create: `src/lib/erp/real/xero/mapper.ts`
- Create: `tests/xero/mapper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/mapper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  xeroContactsToVendors,
  xeroInvoicesToVantorInvoices,
  xeroPaymentToBillPaymentResult,
} from '@/lib/erp/real/xero/mapper';
import {
  ContactsResponseSchema,
  InvoicesResponseSchema,
  PaymentsResponseSchema,
} from '@/lib/erp/real/xero/schemas';
import { loadFixture } from '../helpers/msw-xero';

describe('mapper', () => {
  it('maps Xero contacts to ERPVendorRaw[], filtering non-suppliers', () => {
    const parsed = ContactsResponseSchema.parse(loadFixture('contacts'));
    const vendors = xeroContactsToVendors(parsed);
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors[0].id).toBe('c0000001-0000-0000-0000-000000000001');
    expect(vendors[0].name).toBe('Apex Consulting');
    expect(vendors[0].email).toBe('accounts@apexconsulting.co');
  });

  it('maps Xero invoices to ERPInvoiceRaw[], ACCPAY only', () => {
    const parsed = InvoicesResponseSchema.parse(loadFixture('invoices'));
    const invoices = xeroInvoicesToVantorInvoices(parsed);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices[0].invoiceNumber).toBe('XERO-2025-001');
    expect(invoices[0].amount).toBe(12500);
  });

  it('maps Xero payment response to ERPBillPaymentResult', () => {
    const parsed = PaymentsResponseSchema.parse(loadFixture('payment'));
    const result = xeroPaymentToBillPaymentResult(parsed);
    expect(result.externalPaymentId).toBe('p0000001-0000-0000-0000-000000000001');
    expect(result.status).toBe('recorded');
  });

  it('throws if the payment response is empty', () => {
    expect(() =>
      xeroPaymentToBillPaymentResult({ Payments: [] } as never),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/mapper.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `mapper.ts`**

Create `src/lib/erp/real/xero/mapper.ts`:

```ts
import type {
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentResult,
} from '@/types/erp';
import type {
  ContactsResponse,
  InvoicesResponse,
  PaymentsResponse,
} from './schemas';

export function xeroContactsToVendors(res: ContactsResponse): ERPVendorRaw[] {
  return res.Contacts
    .filter((c) => c.IsSupplier !== false) // include undefined + true
    .map((c) => ({
      id: c.ContactID,
      name: c.Name,
      email: c.EmailAddress,
      // Xero doesn't carry wallet addresses natively — left undefined,
      // matching address is a downstream concern.
      walletAddress: undefined,
      chain: undefined,
    }));
}

export function xeroInvoicesToVantorInvoices(res: InvoicesResponse): ERPInvoiceRaw[] {
  return res.Invoices
    .filter((inv) => inv.Type === 'ACCPAY')
    .map((inv) => ({
      id: inv.InvoiceID,
      invoiceNumber: inv.InvoiceNumber ?? `XERO-${inv.InvoiceID.slice(0, 8)}`,
      vendorId: inv.Contact.ContactID,
      amount: inv.Total,
      // Vantor's token + chain fields are downstream assignments — the raw
      // read from the ERP does not carry stablecoin information. Default to
      // USDC on ethereum; downstream code reassigns based on vendor mapping.
      token: 'USDC',
      chain: 'ethereum',
      description: undefined,
      dueDate: inv.DueDate,
    }));
}

export function xeroPaymentToBillPaymentResult(res: PaymentsResponse): ERPBillPaymentResult {
  const payment = res.Payments[0];
  if (!payment) {
    throw new Error('xeroPaymentToBillPaymentResult: empty Payments array');
  }
  return {
    externalPaymentId: payment.PaymentID,
    status: 'recorded',
    message: `Xero Payment ${payment.PaymentID} recorded against invoice ${payment.Invoice.InvoiceID}`,
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/mapper.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/real/xero/mapper.ts tests/xero/mapper.test.ts
git commit -m "feat(xero): pure mapper from Xero shapes to Vantor ERP types"
```

---

## Phase 5 — Tokens module

This is the dangerous part of the design. Every task in this phase carries the "persist rotated refresh token first" invariant.

### Task 5.1: `tokens.ts` scaffolding — pure helpers

**Files:**
- Create: `src/lib/erp/real/xero/tokens.ts`
- Create: `tests/xero/tokens-pure.test.ts`

- [ ] **Step 1: Write the failing test for pure helpers**

Create `tests/xero/tokens-pure.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { isExpiringSoon, computeExpiresAt } from '@/lib/erp/real/xero/tokens';

describe('tokens pure helpers', () => {
  it('isExpiringSoon returns true within 60s of expiry', () => {
    const now = new Date('2025-04-10T12:00:00Z');
    vi.setSystemTime(now);
    expect(isExpiringSoon(new Date('2025-04-10T12:00:30Z'))).toBe(true);
    expect(isExpiringSoon(new Date('2025-04-10T12:01:30Z'))).toBe(false);
    vi.useRealTimers();
  });

  it('computeExpiresAt adds expires_in seconds to now', () => {
    const now = new Date('2025-04-10T12:00:00Z');
    vi.setSystemTime(now);
    const result = computeExpiresAt(1800);
    expect(result.toISOString()).toBe('2025-04-10T12:30:00.000Z');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/tokens-pure.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement the pure helpers in `tokens.ts`**

Create `src/lib/erp/real/xero/tokens.ts`:

```ts
import type { TokenResponse } from './schemas';

/**
 * A token is "expiring soon" if it will expire within 60 seconds of now.
 * This is the threshold at which we trigger a proactive refresh before
 * making an API call.
 */
export function isExpiringSoon(expiresAt: Date): boolean {
  const cutoff = new Date(Date.now() + 60_000);
  return expiresAt.getTime() < cutoff.getTime();
}

export function computeExpiresAt(expiresInSeconds: number): Date {
  return new Date(Date.now() + expiresInSeconds * 1000);
}

/**
 * In-process per-connection refresh mutex. When a refresh is already in
 * flight for a given connection, concurrent callers await the same promise
 * instead of issuing a second refresh request.
 */
const inFlightRefreshes = new Map<string, Promise<TokenResponse>>();

export function tryAcquireRefreshLock(
  connectionId: string,
  doRefresh: () => Promise<TokenResponse>,
): Promise<TokenResponse> {
  const existing = inFlightRefreshes.get(connectionId);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await doRefresh();
    } finally {
      inFlightRefreshes.delete(connectionId);
    }
  })();
  inFlightRefreshes.set(connectionId, promise);
  return promise;
}

/** Test-only: reset the in-process mutex map between tests. */
export function __resetMutexForTests(): void {
  inFlightRefreshes.clear();
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/tokens-pure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/real/xero/tokens.ts tests/xero/tokens-pure.test.ts
git commit -m "feat(xero): tokens.ts scaffolding with expiry helpers and in-process refresh mutex"
```

### Task 5.2: `refreshAndPersist` with persist-first invariant

**Files:**
- Modify: `src/lib/erp/real/xero/tokens.ts`
- Create: `tests/xero/tokens-refresh.test.ts`

This test requires Testcontainers Postgres + MSW together. It's the most complex integration test in the adapter.

- [ ] **Step 1: Write the failing integration test**

Create `tests/xero/tokens-refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { startTestPostgres, type TestDb } from '../helpers/testcontainers-postgres';
import { makeXeroMswServer } from '../helpers/msw-xero';
import { refreshAndPersist, __resetMutexForTests, type StoredCredentials } from '@/lib/erp/real/xero/tokens';

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';

// Base64 JSON shims used only in Testcontainers tests. Production uses
// the real AES-GCM helpers from src/lib/erp/factory.ts.
const testDecrypt = (c: string): StoredCredentials =>
  JSON.parse(Buffer.from(c, 'base64').toString('utf-8'));
const testEncrypt = (c: StoredCredentials): string =>
  Buffer.from(JSON.stringify(c)).toString('base64');

async function insertFixtureConnection(db: TestDb, overrides: Partial<{ refresh_token: string; access_token: string; expires_at: string }> = {}) {
  const userId = '00000000-0000-0000-0000-000000000001';
  const enterpriseId = '00000000-0000-0000-0000-0000000000aa';
  const refreshToken = overrides.refresh_token ?? 'old-refresh-token';
  const accessToken = overrides.access_token ?? 'old-access-token';
  const expiresAt = overrides.expires_at ?? new Date(Date.now() - 60_000).toISOString();

  await db.client.query(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  await db.client.query(`
    INSERT INTO user_profiles (id) VALUES ($1) ON CONFLICT DO NOTHING
  `, [userId]).catch(() => {});
  const encrypted = Buffer.from(JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  })).toString('base64');

  const res = await db.client.query(`
    INSERT INTO erp_configurations (user_id, enterprise_id, provider, credentials, xero_tenant_id, access_token_expires_at, refresh_token_rotated_at, status)
    VALUES ($1, $2, 'xero', $3, 'tenant-test-0001', $4, now(), 'active')
    RETURNING id
  `, [userId, enterpriseId, encrypted, expiresAt]);
  return res.rows[0].id as string;
}

describe('refreshAndPersist', () => {
  let db: TestDb;
  const server = makeXeroMswServer();

  beforeAll(async () => {
    db = await startTestPostgres();
    server.listen({ onUnhandledRequest: 'error' });
  }, 120_000);

  afterAll(async () => {
    server.close();
    if (db) await db.stop();
  });

  beforeEach(() => {
    __resetMutexForTests();
    server.resetHandlers();
  });

  afterEach(async () => {
    await db.client.query('TRUNCATE erp_configurations CASCADE');
  });

  it('persists the new refresh token and returns new access token', async () => {
    const connectionId = await insertFixtureConnection(db);
    const result = await refreshAndPersist({
      connectionId,
      db: db.client,
      oldRefreshToken: 'old-refresh-token',
      decrypt: testDecrypt,
      encrypt: testEncrypt,
    });
    expect(result.access_token).toBe('new-access-token-rotated');
    expect(result.refresh_token).toBe('new-refresh-token-rotated');

    const row = await db.client.query(
      'SELECT credentials, access_token_expires_at FROM erp_configurations WHERE id = $1',
      [connectionId],
    );
    const creds = JSON.parse(Buffer.from(row.rows[0].credentials, 'base64').toString('utf-8'));
    expect(creds.refresh_token).toBe('new-refresh-token-rotated');
    expect(new Date(row.rows[0].access_token_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('skips refresh if another process already rotated the token', async () => {
    const connectionId = await insertFixtureConnection(db, { refresh_token: 'already-rotated-by-sibling' });
    let tokenCalls = 0;
    server.use(
      ...makeXeroMswServer({ onCall: (ep) => { if (ep === '/connect/token') tokenCalls++; } }).listHandlers(),
    );

    const result = await refreshAndPersist({
      connectionId,
      db: db.client,
      oldRefreshToken: 'old-refresh-token', // stale — caller thinks this is the token
      decrypt: testDecrypt,
      encrypt: testEncrypt,
    });
    expect(tokenCalls).toBe(0);
    expect(result.refresh_token).toBe('already-rotated-by-sibling');
  });

  it('marks connection expired on invalid_grant', async () => {
    const connectionId = await insertFixtureConnection(db);
    const errorServer = makeXeroMswServer({
      tokenResponse: { status: 400, body: { error: 'invalid_grant' } },
    });
    errorServer.listen({ onUnhandledRequest: 'error' });
    try {
      await expect(refreshAndPersist({
        connectionId,
        db: db.client,
        oldRefreshToken: 'old-refresh-token',
        decrypt: testDecrypt,
        encrypt: testEncrypt,
      })).rejects.toMatchObject({ reason_code: 'ERP_XERO_AUTH_EXPIRED' });

      const row = await db.client.query('SELECT status FROM erp_configurations WHERE id = $1', [connectionId]);
      expect(row.rows[0].status).toBe('expired');
    } finally {
      errorServer.close();
    }
  });

  it('concurrent refresh calls only issue one Xero POST', async () => {
    const connectionId = await insertFixtureConnection(db);
    let tokenCalls = 0;
    server.resetHandlers();
    const sharedServer = makeXeroMswServer({ onCall: (ep) => { if (ep === '/connect/token') tokenCalls++; } });
    sharedServer.listen({ onUnhandledRequest: 'error' });
    try {
      const [a, b] = await Promise.all([
        refreshAndPersist({ connectionId, db: db.client, oldRefreshToken: 'old-refresh-token', decrypt: testDecrypt, encrypt: testEncrypt }),
        refreshAndPersist({ connectionId, db: db.client, oldRefreshToken: 'old-refresh-token', decrypt: testDecrypt, encrypt: testEncrypt }),
      ]);
      expect(tokenCalls).toBe(1);
      expect(a.refresh_token).toBe(b.refresh_token);
    } finally {
      sharedServer.close();
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/tokens-refresh.test.ts`
Expected: FAIL with "refreshAndPersist not exported".

- [ ] **Step 3: Implement `refreshAndPersist`**

Append to `src/lib/erp/real/xero/tokens.ts`:

```ts
import type { Client } from 'pg';
import { TokenResponseSchema, type TokenResponse } from './schemas';
import { xeroAuthExpired, xeroRefreshPersistFailure, xeroUpstreamFailure } from './errors';
import { randomUUID } from 'node:crypto';

const XERO_TOKEN_ENDPOINT = 'https://identity.xero.com/connect/token';

export interface StoredCredentials {
  access_token: string;
  refresh_token: string;
  clientId: string;
  clientSecret: string;
}

export interface RefreshAndPersistInput {
  connectionId: string;
  db: Client;  // pg Client or Supabase-backed adapter with the same query() surface
  oldRefreshToken: string;
  /** Ciphertext decoder. Production: src/lib/erp/factory.ts::decryptCredentials. Tests: base64 JSON. */
  decrypt: (ciphertext: string) => StoredCredentials;
  /** Ciphertext encoder. Production: src/lib/erp/factory.ts::encryptCredentials. Tests: base64 JSON. */
  encrypt: (creds: StoredCredentials) => string;
}

async function postRefreshToXero(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  traceId: string,
  connectionId: string,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(XERO_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
  } catch (err) {
    throw xeroUpstreamFailure({
      connection_id: connectionId,
      endpoint: '/connect/token',
      trace_id: traceId,
      cause: (err as Error).message,
    });
  }

  if (res.status === 400) {
    const body = await res.text();
    if (body.includes('invalid_grant')) {
      throw xeroAuthExpired({
        connection_id: connectionId,
        endpoint: '/connect/token',
        trace_id: traceId,
      });
    }
  }

  if (res.status >= 500 || res.status === 0) {
    throw xeroUpstreamFailure({
      connection_id: connectionId,
      endpoint: '/connect/token',
      trace_id: res.headers.get('X-Trace-Id') ?? traceId,
    });
  }

  const body = await res.json();
  return TokenResponseSchema.parse(body);
}

export async function refreshAndPersist(input: RefreshAndPersistInput): Promise<TokenResponse> {
  return tryAcquireRefreshLock(input.connectionId, async () => {
    const traceId = randomUUID();

    // Step 2 (from spec): reload the row inside the lock. If a sibling
    // process already rotated the refresh token, use the DB's current tokens
    // and skip the Xero POST entirely.
    const reloaded = await input.db.query(
      'SELECT credentials FROM erp_configurations WHERE id = $1',
      [input.connectionId],
    );
    if (reloaded.rowCount === 0) {
      throw xeroAuthExpired({
        connection_id: input.connectionId,
        endpoint: '/connect/token',
        trace_id: traceId,
      });
    }
    const currentCreds = input.decrypt(reloaded.rows[0].credentials);
    if (currentCreds.refresh_token !== input.oldRefreshToken) {
      return {
        access_token: currentCreds.access_token,
        refresh_token: currentCreds.refresh_token,
        expires_in: 1800,
      };
    }

    // Step 3: call Xero.
    let tokenResponse: TokenResponse;
    try {
      tokenResponse = await postRefreshToXero(
        currentCreds.clientId,
        currentCreds.clientSecret,
        input.oldRefreshToken,
        traceId,
        input.connectionId,
      );
    } catch (err) {
      if ((err as { reason_code?: string }).reason_code === 'ERP_XERO_AUTH_EXPIRED') {
        // Step 4: invalid_grant → mark connection expired.
        await input.db.query(
          `UPDATE erp_configurations SET status = 'expired' WHERE id = $1`,
          [input.connectionId],
        );
      }
      throw err;
    }

    // Step 6: persist FIRST. Retry up to 3 times on DB failure.
    const newCreds: StoredCredentials = {
      ...currentCreds,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
    };
    const encrypted = input.encrypt(newCreds);
    const expiresAt = computeExpiresAt(tokenResponse.expires_in);

    let persisted = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await input.db.query(
          `UPDATE erp_configurations
             SET credentials = $2,
                 access_token_expires_at = $3,
                 refresh_token_rotated_at = now(),
                 status = 'active'
           WHERE id = $1`,
          [input.connectionId, encrypted, expiresAt],
        );
        persisted = true;
        break;
      } catch (err) {
        if (attempt === 3) {
          await input.db.query(
            `UPDATE erp_configurations SET status = 'needs_reconnect' WHERE id = $1`,
            [input.connectionId],
          ).catch(() => { /* best-effort */ });
          throw xeroRefreshPersistFailure({
            connection_id: input.connectionId,
            endpoint: '/connect/token',
            trace_id: traceId,
            attempts: 3,
            cause: (err as Error).message,
          });
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    if (!persisted) {
      throw xeroRefreshPersistFailure({
        connection_id: input.connectionId,
        endpoint: '/connect/token',
        trace_id: traceId,
      });
    }

    return tokenResponse;
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/tokens-refresh.test.ts`
Expected: PASS (4 tests). Testcontainers startup takes ~30s on first run.

If the test fails because the `user_profiles` insert throws — the Testcontainers schema shim doesn't include `user_profiles` yet. Add a catch-up insert block in `testcontainers-postgres.ts` or have the test helper create the minimal `user_profiles` row before inserting into `erp_configurations`. Fix, rerun.

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/real/xero/tokens.ts tests/xero/tokens-refresh.test.ts
git commit -m "feat(xero): refreshAndPersist with persist-first invariant and reload-before-refresh"
```

---

## Phase 6 — XeroClient HTTP wrapper

### Task 6.1: `client.ts` scaffold — constructor, request helper, header injection

**Files:**
- Create: `src/lib/erp/real/xero/client.ts`
- Create: `tests/xero/client-get.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/client-get.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeXeroMswServer } from '../helpers/msw-xero';
import { XeroClient } from '@/lib/erp/real/xero/client';

describe('XeroClient — basic GET', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('injects xero-tenant-id and Authorization headers', async () => {
    let sawHeaders: Headers | undefined;
    server.use(
      ...makeXeroMswServer({
        onCall: () => {},
      }).listHandlers(),
    );
    const client = new XeroClient({
      connectionId: 'c-1',
      tenantId: 'tenant-test-0001',
      accessToken: 'access-token-valid',
      accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
      refreshToken: 'rt',
      clientId: 'ci',
      clientSecret: 'cs',
      refresh: async () => { throw new Error('should not refresh'); },
    });
    const result = await client.getContacts();
    expect(result.Contacts.length).toBeGreaterThan(0);
  });

  it('parses contacts through the Zod schema', async () => {
    const client = new XeroClient({
      connectionId: 'c-1',
      tenantId: 'tenant-test-0001',
      accessToken: 'access-token-valid',
      accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
      refreshToken: 'rt',
      clientId: 'ci',
      clientSecret: 'cs',
      refresh: async () => { throw new Error('should not refresh'); },
    });
    const res = await client.getContacts();
    expect(res.Contacts[0].ContactID).toBe('c0000001-0000-0000-0000-000000000001');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/client-get.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `client.ts` (scaffold only)**

Create `src/lib/erp/real/xero/client.ts`:

```ts
import { randomUUID } from 'node:crypto';
import {
  ContactsResponseSchema, type ContactsResponse,
  InvoicesResponseSchema, type InvoicesResponse,
  AccountsResponseSchema, type AccountsResponse,
  PaymentsResponseSchema, type PaymentsResponse,
  ConnectionsResponseSchema, type ConnectionsResponse,
  type TokenResponse,
} from './schemas';
import {
  xeroUpstreamFailure,
  xeroRateLimited,
  xeroAuthExpired,
  xeroValidation,
} from './errors';
import { isExpiringSoon } from './tokens';
import type { z } from 'zod';

const API_BASE = 'https://api.xero.com';

export interface XeroClientInput {
  connectionId: string;
  tenantId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  /** Callback that performs a refresh + returns the new token response. */
  refresh: () => Promise<TokenResponse>;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export class XeroClient {
  private accessToken: string;
  private accessTokenExpiresAt: Date;
  private refreshToken: string;
  private readonly connectionId: string;
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refresh: () => Promise<TokenResponse>;

  constructor(input: XeroClientInput) {
    this.connectionId = input.connectionId;
    this.tenantId = input.tenantId;
    this.accessToken = input.accessToken;
    this.accessTokenExpiresAt = input.accessTokenExpiresAt;
    this.refreshToken = input.refreshToken;
    this.clientId = input.clientId;
    this.clientSecret = input.clientSecret;
    this.refresh = input.refresh;
  }

  private async ensureFreshToken(): Promise<void> {
    if (isExpiringSoon(this.accessTokenExpiresAt)) {
      const refreshed = await this.refresh();
      this.accessToken = refreshed.access_token;
      this.refreshToken = refreshed.refresh_token;
      this.accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
    }
  }

  private async request<T>(opts: RequestOptions, schema: z.ZodType<T>): Promise<T> {
    await this.ensureFreshToken();
    const url = new URL(`${API_BASE}${opts.path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }
    const traceId = randomUUID();

    const doFetch = async (accessToken: string): Promise<Response> => {
      return fetch(url.toString(), {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'xero-tenant-id': this.tenantId,
          Accept: 'application/json',
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    };

    let res: Response;
    try {
      res = await doFetch(this.accessToken);
    } catch (err) {
      throw xeroUpstreamFailure({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: traceId,
        cause: (err as Error).message,
      });
    }

    // Reactive refresh on 401.
    if (res.status === 401) {
      const refreshed = await this.refresh();
      this.accessToken = refreshed.access_token;
      this.refreshToken = refreshed.refresh_token;
      this.accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
      try {
        res = await doFetch(this.accessToken);
      } catch (err) {
        throw xeroUpstreamFailure({
          connection_id: this.connectionId,
          xero_tenant_id: this.tenantId,
          endpoint: opts.path,
          trace_id: traceId,
          cause: (err as Error).message,
        });
      }
      if (res.status === 401) {
        throw xeroAuthExpired({
          connection_id: this.connectionId,
          xero_tenant_id: this.tenantId,
          endpoint: opts.path,
          trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        });
      }
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
      const dailyRemaining = Number(res.headers.get('X-DayLimit-Remaining') ?? '0') || undefined;
      throw xeroRateLimited({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        retry_after_seconds: retryAfter,
        daily_limit_remaining: dailyRemaining,
      });
    }

    if (res.status >= 500) {
      throw xeroUpstreamFailure({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        status: res.status,
      });
    }

    const raw = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw xeroValidation({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        zod_issues: [{ path: [], message: 'invalid JSON' }],
        body_prefix: raw,
      });
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw xeroValidation({
        connection_id: this.connectionId,
        xero_tenant_id: this.tenantId,
        endpoint: opts.path,
        trace_id: res.headers.get('X-Trace-Id') ?? traceId,
        zod_issues: result.error.issues,
        body_prefix: raw,
      });
    }
    return result.data;
  }

  async getContacts(): Promise<ContactsResponse> {
    return this.request(
      { path: '/api.xro/2.0/Contacts', query: { where: 'IsSupplier==true' } },
      ContactsResponseSchema,
    );
  }

  async getInvoices(): Promise<InvoicesResponse> {
    return this.request(
      { path: '/api.xro/2.0/Invoices', query: { where: 'Type=="ACCPAY"' } },
      InvoicesResponseSchema,
    );
  }

  async getBankAccounts(): Promise<AccountsResponse> {
    return this.request(
      { path: '/api.xro/2.0/Accounts', query: { where: 'Type=="BANK"' } },
      AccountsResponseSchema,
    );
  }

  async getConnections(): Promise<ConnectionsResponse> {
    return this.request({ path: '/connections' }, ConnectionsResponseSchema);
  }

  async createPayment(input: {
    invoiceId: string;
    bankAccountId: string;
    amount: number;
    paymentDate: string;
    reference: string;
  }): Promise<PaymentsResponse> {
    return this.request(
      {
        method: 'POST',
        path: '/api.xro/2.0/Payments',
        body: {
          Invoice: { InvoiceID: input.invoiceId },
          Account: { AccountID: input.bankAccountId },
          Date: input.paymentDate,
          Amount: input.amount,
          CurrencyRate: 1,
          Reference: input.reference,
        },
      },
      PaymentsResponseSchema,
    );
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/client-get.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/real/xero/client.ts tests/xero/client-get.test.ts
git commit -m "feat(xero): XeroClient with tenant header injection and Zod-validated responses"
```

### Task 6.2: Test 401 reactive refresh + retry

**Files:**
- Create: `tests/xero/client-401-retry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/client-401-retry.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { loadFixture } from '../helpers/msw-xero';
import { XeroClient } from '@/lib/erp/real/xero/client';

function buildClient(refresh: () => Promise<{ access_token: string; refresh_token: string; expires_in: number }>) {
  return new XeroClient({
    connectionId: 'c-1',
    tenantId: 'tenant-test-0001',
    accessToken: 'old-access-token',
    accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
    refreshToken: 'old-refresh-token',
    clientId: 'ci',
    clientSecret: 'cs',
    refresh,
  });
}

describe('XeroClient 401 handling', () => {
  let contactsCalls = 0;

  const server = setupServer(
    http.get('https://api.xero.com/api.xro/2.0/Contacts', ({ request }) => {
      contactsCalls++;
      const auth = request.headers.get('authorization');
      if (auth === 'Bearer old-access-token') {
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      return HttpResponse.json(loadFixture('contacts'));
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { contactsCalls = 0; });
  afterAll(() => server.close());

  it('refreshes and retries once on 401', async () => {
    const refresh = vi.fn(async () => ({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 1800,
    }));
    const client = buildClient(refresh);
    const res = await client.getContacts();
    expect(res.Contacts.length).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(contactsCalls).toBe(2); // original + retry
  });

  it('throws ERP_XERO_AUTH_EXPIRED if the retry also 401s', async () => {
    const refresh = vi.fn(async () => ({
      access_token: 'still-bad-token',
      refresh_token: 'new-refresh-token',
      expires_in: 1800,
    }));
    server.use(
      http.get('https://api.xero.com/api.xro/2.0/Contacts', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
    );
    const client = buildClient(refresh);
    await expect(client.getContacts()).rejects.toMatchObject({
      reason_code: 'ERP_XERO_AUTH_EXPIRED',
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --run tests/xero/client-401-retry.test.ts`
Expected: PASS (both already supported by the client built in 6.1).

- [ ] **Step 3: Commit**

```bash
git add tests/xero/client-401-retry.test.ts
git commit -m "test(xero): 401 reactive refresh + second-401 auth-expired"
```

### Task 6.3: Test 429 and 5xx paths

**Files:**
- Create: `tests/xero/client-429-5xx.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/xero/client-429-5xx.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { XeroClient } from '@/lib/erp/real/xero/client';

function buildClient() {
  return new XeroClient({
    connectionId: 'c-1',
    tenantId: 'tenant-test-0001',
    accessToken: 'ok',
    accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
    refreshToken: 'rt',
    clientId: 'ci',
    clientSecret: 'cs',
    refresh: async () => { throw new Error('should not refresh'); },
  });
}

describe('XeroClient 429 / 5xx', () => {
  const server = setupServer(
    http.get('https://api.xero.com/api.xro/2.0/Contacts', () =>
      new HttpResponse(JSON.stringify({}), {
        status: 429,
        headers: { 'Retry-After': '30', 'X-DayLimit-Remaining': '2500' },
      }),
    ),
    http.get('https://api.xero.com/api.xro/2.0/Invoices', () =>
      new HttpResponse(JSON.stringify({}), { status: 503 }),
    ),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('throws ERP_XERO_RATE_LIMITED with parsed retry-after', async () => {
    const client = buildClient();
    await expect(client.getContacts()).rejects.toMatchObject({
      reason_code: 'ERP_XERO_RATE_LIMITED',
      fields: { retry_after_seconds: 30, daily_limit_remaining: 2500 },
    });
  });

  it('throws ERP_XERO_UPSTREAM_FAILURE on 503', async () => {
    server.use(
      http.get('https://api.xero.com/api.xro/2.0/Invoices', () =>
        new HttpResponse(JSON.stringify({}), { status: 503 }),
      ),
    );
    const client = buildClient();
    await expect(client.getInvoices()).rejects.toMatchObject({
      reason_code: 'ERP_XERO_UPSTREAM_FAILURE',
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --run tests/xero/client-429-5xx.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/xero/client-429-5xx.test.ts
git commit -m "test(xero): 429 rate-limit and 5xx upstream-failure paths"
```

### Task 6.4: Test createPayment happy path

**Files:**
- Create: `tests/xero/client-payment.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/xero/client-payment.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { loadFixture } from '../helpers/msw-xero';
import { XeroClient } from '@/lib/erp/real/xero/client';

describe('XeroClient.createPayment', () => {
  let capturedBody: unknown;
  const server = setupServer(
    http.post('https://api.xero.com/api.xro/2.0/Payments', async ({ request }) => {
      capturedBody = await request.json();
      return HttpResponse.json(loadFixture('payment'));
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { capturedBody = undefined; });
  afterAll(() => server.close());

  it('POSTs the correct shape and parses the response', async () => {
    const client = new XeroClient({
      connectionId: 'c-1',
      tenantId: 'tenant-test-0001',
      accessToken: 'ok',
      accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
      refreshToken: 'rt',
      clientId: 'ci',
      clientSecret: 'cs',
      refresh: async () => { throw new Error('nope'); },
    });

    const res = await client.createPayment({
      invoiceId: 'i0000001-0000-0000-0000-000000000001',
      bankAccountId: 'a0000001-0000-0000-0000-000000000001',
      amount: 12500,
      paymentDate: '2025-04-10',
      reference: 'Vantor-USDC tx:0xabcdef',
    });

    expect(res.Payments[0].PaymentID).toBe('p0000001-0000-0000-0000-000000000001');
    expect(capturedBody).toMatchObject({
      Invoice: { InvoiceID: 'i0000001-0000-0000-0000-000000000001' },
      Account: { AccountID: 'a0000001-0000-0000-0000-000000000001' },
      Amount: 12500,
      Reference: 'Vantor-USDC tx:0xabcdef',
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --run tests/xero/client-payment.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/xero/client-payment.test.ts
git commit -m "test(xero): createPayment posts correct shape and parses response"
```

---

## Phase 7 — XeroRealAdapter + factory wiring

### Task 7.1: `adapter.ts` — implements `IERPAdapter`

**Files:**
- Create: `src/lib/erp/real/xero/adapter.ts`
- Create: `tests/xero/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/adapter.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeXeroMswServer } from '../helpers/msw-xero';
import { XeroRealAdapter } from '@/lib/erp/real/xero/adapter';

const baseConnection = {
  connectionId: 'c-1',
  tenantId: 'tenant-test-0001',
  bankAccountId: 'a0000001-0000-0000-0000-000000000001',
  accessToken: 'ok',
  accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
  refreshToken: 'rt',
  clientId: 'ci',
  clientSecret: 'cs',
  refresh: async () => ({ access_token: 'nope', refresh_token: 'nope', expires_in: 1800 }),
};

describe('XeroRealAdapter', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('fetchVendors returns mapped ERPVendorRaw[]', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const vendors = await adapter.fetchVendors();
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors[0].name).toBe('Apex Consulting');
  });

  it('fetchInvoices returns mapped ERPInvoiceRaw[]', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const invoices = await adapter.fetchInvoices();
    expect(invoices[0].invoiceNumber).toBe('XERO-2025-001');
  });

  it('recordBillPayment returns externalPaymentId', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const result = await adapter.recordBillPayment({
      invoiceId: 'i0000001-0000-0000-0000-000000000001',
      amount: 12500,
      currency: 'USD',
      paymentDate: '2025-04-10',
      reference: 'Vantor-USDC',
      externalTxHash: '0xabcdef',
    });
    expect(result.externalPaymentId).toBe('p0000001-0000-0000-0000-000000000001');
    expect(result.status).toBe('recorded');
  });

  it('testConnection returns success on a real /connections hit', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/adapter.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `adapter.ts`**

Create `src/lib/erp/real/xero/adapter.ts`:

```ts
import type {
  IERPAdapter,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentPayload,
  ERPBillPaymentResult,
} from '@/types/erp';
import { XeroClient, type XeroClientInput } from './client';
import {
  xeroContactsToVendors,
  xeroInvoicesToVantorInvoices,
  xeroPaymentToBillPaymentResult,
} from './mapper';

export interface XeroRealAdapterInput extends XeroClientInput {
  bankAccountId: string;
}

export class XeroRealAdapter implements IERPAdapter {
  readonly provider = 'xero';
  private readonly client: XeroClient;
  private readonly bankAccountId: string;

  constructor(input: XeroRealAdapterInput) {
    this.client = new XeroClient(input);
    this.bankAccountId = input.bankAccountId;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const conns = await this.client.getConnections();
      return {
        success: conns.length > 0,
        message: conns.length > 0
          ? `Xero connection OK (${conns.length} tenant${conns.length > 1 ? 's' : ''})`
          : 'No Xero tenants visible to this connection',
      };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    const res = await this.client.getContacts();
    return xeroContactsToVendors(res);
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    const res = await this.client.getInvoices();
    return xeroInvoicesToVantorInvoices(res);
  }

  async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
    const res = await this.client.createPayment({
      invoiceId: payload.invoiceId,
      bankAccountId: this.bankAccountId,
      amount: payload.amount,
      paymentDate: payload.paymentDate,
      reference: `${payload.reference} tx:${payload.externalTxHash}`,
    });
    return xeroPaymentToBillPaymentResult(res);
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/real/xero/adapter.ts tests/xero/adapter.test.ts
git commit -m "feat(xero): XeroRealAdapter implementing IERPAdapter"
```

### Task 7.2: Wire `XeroRealAdapter` into `factory.ts`

**Files:**
- Modify: `src/lib/erp/factory.ts`

- [ ] **Step 1: Update the factory**

Replace the real-adapter branch in `src/lib/erp/factory.ts`. After `if (useMock)` block, replace the throwing line with:

```ts
// Real adapters
switch (provider) {
  case 'xero': {
    // The factory only accepts a credentials blob. Real callers (sync
    // endpoints) must load the full erp_configurations row first and build
    // the adapter input via src/lib/erp/real/xero/build-adapter.ts so that
    // connectionId, tenantId, bankAccountId, and refresh plumbing are wired.
    throw new Error(
      'Use buildXeroAdapter(erpConfigRow) from src/lib/erp/real/xero/build-adapter.ts — getERPAdapter() alone cannot build a real Xero adapter.',
    );
  }
  default:
    throw new Error(
      `Real ERP adapter for '${provider}' not implemented. Set ERP_USE_MOCK=true.`,
    );
}
```

- [ ] **Step 2: Create `build-adapter.ts` as the real entry point**

Create `src/lib/erp/real/xero/build-adapter.ts`:

```ts
import type { Client } from 'pg';
import { XeroRealAdapter } from './adapter';
import { refreshAndPersist, type StoredCredentials } from './tokens';
import { xeroNotConnected } from './errors';

export interface ErpConfigRow {
  id: string;
  credentials: string;  // encrypted blob
  xero_tenant_id: string | null;
  xero_bank_account_id: string | null;
  access_token_expires_at: string | null;
  status: string | null;
}

export interface BuildXeroAdapterDeps {
  db: Client;
  /** In prod: src/lib/erp/factory.ts::decryptCredentials. */
  decrypt: (ciphertext: string) => StoredCredentials;
  /** In prod: src/lib/erp/factory.ts::encryptCredentials. */
  encrypt: (creds: StoredCredentials) => string;
}

export function buildXeroAdapter(row: ErpConfigRow, deps: BuildXeroAdapterDeps): XeroRealAdapter {
  if (!row.xero_tenant_id || !row.xero_bank_account_id || !row.access_token_expires_at) {
    throw xeroNotConnected({
      connection_id: row.id,
      endpoint: 'buildXeroAdapter',
      trace_id: crypto.randomUUID(),
    });
  }

  const creds = deps.decrypt(row.credentials);

  return new XeroRealAdapter({
    connectionId: row.id,
    tenantId: row.xero_tenant_id,
    bankAccountId: row.xero_bank_account_id,
    accessToken: creds.access_token,
    accessTokenExpiresAt: new Date(row.access_token_expires_at),
    refreshToken: creds.refresh_token,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    refresh: async () => refreshAndPersist({
      connectionId: row.id,
      db: deps.db,
      oldRefreshToken: creds.refresh_token,
      decrypt: deps.decrypt,
      encrypt: deps.encrypt,
    }),
  });
}
```

- [ ] **Step 3: Run the type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/erp/factory.ts src/lib/erp/real/xero/build-adapter.ts
git commit -m "feat(xero): buildXeroAdapter entry point + factory stub pointing at it"
```

---

## Phase 8 — OAuth routes + connect UI wire-up

### Task 8.1: `/api/erp/xero/authorize` route

**Files:**
- Create: `src/app/api/erp/xero/authorize/route.ts`
- Create: `tests/xero/authorize-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/authorize-route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: async () => ({
    user: { id: 'user-1', enterprise_id: 'ent-1' },
  }),
}));
vi.mock('@/lib/auth/nextauth.config', () => ({ authOptions: {} }));

describe('/api/erp/xero/authorize', () => {
  it('redirects to Xero with the required query params', async () => {
    process.env.XERO_CLIENT_ID = 'test-ci';
    process.env.XERO_REDIRECT_URI = 'https://www.example.com/api/erp/xero/callback';
    const { GET } = await import('@/app/api/erp/xero/authorize/route');
    const res = await GET(new Request('https://www.example.com/api/erp/xero/authorize'));
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('https://login.xero.com/identity/connect/authorize');
    expect(location).toContain('response_type=code');
    expect(location).toContain('client_id=test-ci');
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('scope=');

    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('xero_oauth=');
    expect(cookie).toContain('HttpOnly');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/authorize-route.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `authorize/route.ts`**

Create `src/app/api/erp/xero/authorize/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { randomBytes, createHash } from 'node:crypto';

const SCOPES = [
  'offline_access',
  'accounting.contacts.read',
  'accounting.transactions',
  'accounting.journals',
].join(' ');

export async function GET(_req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.XERO_CLIENT_ID!;
  const redirectUri = process.env.XERO_REDIRECT_URI!;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');

  const cookiePayload = JSON.stringify({
    verifier,
    state,
    user_id: session.user.id,
    // @ts-expect-error augmented session
    enterprise_id: session.user.enterprise_id,
  });
  // MVP cookie protection relies on HttpOnly + SameSite=Lax + 10-minute TTL
  // (see spec §Token Lifecycle — Out of scope). HMAC-signing with
  // NEXTAUTH_SECRET is an intentional follow-up hardening and is not part
  // of this slice.
  const cookieValue = Buffer.from(cookiePayload).toString('base64url');

  const authorizeUrl = new URL('https://login.xero.com/identity/connect/authorize');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', SCOPES);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const res = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
  res.headers.append('set-cookie',
    `xero_oauth=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return res;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/authorize-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/erp/xero/authorize/route.ts tests/xero/authorize-route.test.ts
git commit -m "feat(xero): /api/erp/xero/authorize route generates PKCE + signed state cookie"
```

### Task 8.2: `/api/erp/xero/callback` route

**Files:**
- Create: `src/app/api/erp/xero/callback/route.ts`
- Create: `tests/xero/callback-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/xero/callback-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { loadFixture } from '../helpers/msw-xero';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      upsert: vi.fn().mockReturnValue({
        select: () => ({ single: async () => ({ data: { id: 'ec-1' }, error: null }) }),
      }),
    }),
  }),
}));

describe('/api/erp/xero/callback', () => {
  const server = setupServer(
    http.post('https://identity.xero.com/connect/token', () =>
      HttpResponse.json({
        access_token: 'ac-new',
        refresh_token: 'rt-new',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    ),
    http.get('https://api.xero.com/connections', () =>
      HttpResponse.json([
        {
          id: 'conn-1',
          tenantId: 'tenant-test-0001',
          tenantType: 'ORGANISATION',
          tenantName: 'Demo Company (Global)',
        },
      ]),
    ),
    http.get('https://api.xero.com/api.xro/2.0/Accounts', () =>
      HttpResponse.json(loadFixture('accounts-bank')),
    ),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('redirects to /settings/erp?xero=connected on success', async () => {
    process.env.XERO_CLIENT_ID = 'ci';
    process.env.XERO_CLIENT_SECRET = 'cs';
    process.env.XERO_REDIRECT_URI = 'https://www.example.com/api/erp/xero/callback';

    const cookiePayload = Buffer.from(JSON.stringify({
      verifier: 'v',
      state: 'S1',
      user_id: 'user-1',
      enterprise_id: 'ent-1',
    })).toString('base64url');

    const { GET } = await import('@/app/api/erp/xero/callback/route');
    const req = new Request('https://www.example.com/api/erp/xero/callback?code=auth-code&state=S1', {
      headers: { cookie: `xero_oauth=${cookiePayload}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/settings/erp?xero=connected');
  });

  it('rejects state mismatch', async () => {
    const cookiePayload = Buffer.from(JSON.stringify({
      verifier: 'v',
      state: 'S1',
      user_id: 'user-1',
      enterprise_id: 'ent-1',
    })).toString('base64url');

    const { GET } = await import('@/app/api/erp/xero/callback/route');
    const req = new Request('https://www.example.com/api/erp/xero/callback?code=auth-code&state=WRONG', {
      headers: { cookie: `xero_oauth=${cookiePayload}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason_code).toBe('ERP_XERO_STATE_MISMATCH');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run tests/xero/callback-route.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `callback/route.ts`**

Create `src/app/api/erp/xero/callback/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { encryptCredentials } from '@/lib/erp/factory';
import { xeroStateMismatch, xeroUpstreamFailure, xeroValidation } from '@/lib/erp/real/xero/errors';
import { TokenResponseSchema, ConnectionsResponseSchema, AccountsResponseSchema } from '@/lib/erp/real/xero/schemas';
import { randomUUID } from 'node:crypto';

function readCookie(req: Request): { verifier: string; state: string; user_id: string; enterprise_id: string } | null {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(/xero_oauth=([^;]+)/);
  if (!match) return null;
  try {
    return JSON.parse(Buffer.from(match[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = readCookie(req);
  const traceId = randomUUID();

  if (!cookie || !code || !state || state !== cookie.state) {
    return NextResponse.json(
      xeroStateMismatch({ endpoint: '/api/erp/xero/callback', trace_id: traceId }).toUserFacing(),
      { status: 400 },
    );
  }

  const clientId = process.env.XERO_CLIENT_ID!;
  const clientSecret = process.env.XERO_CLIENT_SECRET!;
  const redirectUri = process.env.XERO_REDIRECT_URI!;

  // Exchange code for tokens.
  const tokenRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: cookie.verifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    return NextResponse.json(
      xeroUpstreamFailure({
        endpoint: '/connect/token',
        trace_id: tokenRes.headers.get('X-Trace-Id') ?? traceId,
      }).toUserFacing(),
      { status: 502 },
    );
  }

  const tokenBody = await tokenRes.json();
  const tokenParsed = TokenResponseSchema.safeParse(tokenBody);
  if (!tokenParsed.success) {
    return NextResponse.json(
      xeroValidation({
        endpoint: '/connect/token',
        trace_id: traceId,
        zod_issues: tokenParsed.error.issues,
        body_prefix: JSON.stringify(tokenBody).slice(0, 200),
      }).toUserFacing(),
      { status: 502 },
    );
  }
  const tokens = tokenParsed.data;

  // Resolve tenant.
  const connectionsRes = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  });
  const connectionsBody = await connectionsRes.json();
  const connectionsParsed = ConnectionsResponseSchema.safeParse(connectionsBody);
  if (!connectionsParsed.success) {
    return NextResponse.json(
      xeroValidation({
        endpoint: '/connections',
        trace_id: traceId,
        zod_issues: connectionsParsed.error.issues,
        body_prefix: JSON.stringify(connectionsBody).slice(0, 200),
      }).toUserFacing(),
      { status: 502 },
    );
  }
  const orgs = connectionsParsed.data.filter((c) => c.tenantType === 'ORGANISATION');
  if (orgs.length === 0) {
    return NextResponse.json({ error: 'No ORGANISATION tenants' }, { status: 400 });
  }
  const chosen = orgs[0];
  if (orgs.length > 1) {
    // eslint-disable-next-line no-console
    console.warn('[xero-connect] multiple orgs — auto-picked first', { picked: chosen.tenantId, all: orgs.map((o) => o.tenantId) });
  }

  // Resolve bank account.
  const acctsRes = await fetch('https://api.xero.com/api.xro/2.0/Accounts?where=Type=="BANK"', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'xero-tenant-id': chosen.tenantId,
      Accept: 'application/json',
    },
  });
  const acctsBody = await acctsRes.json();
  const acctsParsed = AccountsResponseSchema.safeParse(acctsBody);
  if (!acctsParsed.success || acctsParsed.data.Accounts.length === 0) {
    return NextResponse.json(
      xeroValidation({
        endpoint: '/Accounts',
        trace_id: traceId,
        zod_issues: acctsParsed.success ? [{ message: 'no BANK accounts' }] : acctsParsed.error.issues,
        body_prefix: JSON.stringify(acctsBody).slice(0, 200),
      }).toUserFacing(),
      { status: 502 },
    );
  }
  const bankAccount = acctsParsed.data.Accounts[0];

  // Encrypt + upsert. encryptCredentials is async — must await.
  const credentialsBlob = await encryptCredentials({
    apiUrl: 'https://api.xero.com',
    clientId,
    clientSecret,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  } as never);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('erp_configurations')
    .upsert(
      {
        user_id: cookie.user_id,
        enterprise_id: cookie.enterprise_id,
        provider: 'xero',
        credentials: credentialsBlob,
        xero_tenant_id: chosen.tenantId,
        xero_bank_account_id: bankAccount.AccountID,
        access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        refresh_token_rotated_at: new Date().toISOString(),
        status: 'active',
        is_active: true,
      },
      { onConflict: 'user_id,provider' },
    );

  if (error) {
    return NextResponse.json({ error: 'Failed to store Xero connection' }, { status: 500 });
  }

  const redirectRes = NextResponse.redirect(new URL('/settings/erp?xero=connected', req.url).toString(), { status: 302 });
  redirectRes.headers.append('set-cookie', 'xero_oauth=; Path=/; HttpOnly; Max-Age=0');
  return redirectRes;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- --run tests/xero/callback-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/erp/xero/callback/route.ts tests/xero/callback-route.test.ts
git commit -m "feat(xero): /api/erp/xero/callback exchanges code, resolves tenant + bank account, persists connection"
```

### Task 8.3: Wire "Connect Xero" button in `/settings/erp` page

**Files:**
- Modify: `src/app/(app)/settings/erp/page.tsx`

- [ ] **Step 1: Read the current page**

Run: `cat src/app/\(app\)/settings/erp/page.tsx | head -100`
Find where the ERP providers are rendered and where a click handler would go.

- [ ] **Step 2: Add "Connect Xero" that navigates to `/api/erp/xero/authorize`**

In the Xero provider card (locate by the `'xero'` string or the Xero logo import), add/update the "Connect" button handler:

```tsx
<a
  href="/api/erp/xero/authorize"
  className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
>
  Connect Xero
</a>
```

- [ ] **Step 3: Add a success banner when `?xero=connected` is in the query**

Near the top of the page component body:

```tsx
const searchParams = useSearchParams();
const xeroConnected = searchParams.get('xero') === 'connected';
// ...in JSX:
{xeroConnected && (
  <div className="mb-4 rounded-md bg-green-50 dark:bg-green-950 p-3 text-sm text-green-700 dark:text-green-300">
    Xero connected successfully.
  </div>
)}
```

Import `useSearchParams` from `next/navigation` if not already imported, and mark the component as `'use client'` if it isn't.

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/settings/erp/page.tsx
git commit -m "feat(xero): Connect Xero button + success banner on /settings/erp"
```

---

## Phase 9 — Live test suite + CI workflow

### Task 9.1: Live test Vitest config

**Files:**
- Create: `tests/xero-live/vitest.config.ts`
- Modify: `package.json` (add `test:xero:live` script)

- [ ] **Step 1: Write the config**

Create `tests/xero-live/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/xero-live/**/*.test.ts'],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
    },
  },
});
```

- [ ] **Step 2: Add `test:xero:live` script**

Edit `package.json` scripts:

```json
"test:xero:live": "XERO_LIVE_TESTS=1 vitest run --config tests/xero-live/vitest.config.ts"
```

- [ ] **Step 3: Commit**

```bash
git add tests/xero-live/vitest.config.ts package.json
git commit -m "test(xero-live): dedicated Vitest config and test:xero:live script"
```

### Task 9.2: `xero_ci_bootstrap` helpers

**Files:**
- Create: `tests/xero-live/helpers/bootstrap.ts`

- [ ] **Step 1: Write the bootstrap helpers**

Create `tests/xero-live/helpers/bootstrap.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

/**
 * Reads the current Xero refresh token from the xero_ci_bootstrap singleton
 * row, calls Xero to rotate it, writes the new refresh token back, and
 * returns the new access token + tenant id for use by live tests.
 */
export async function bootstrapXeroFromCi(): Promise<{
  accessToken: string;
  tenantId: string;
  bankAccountId: string;
}> {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data, error } = await supabase
    .from('xero_ci_bootstrap')
    .select('refresh_token')
    .eq('id', 1)
    .single();
  if (error || !data) throw new Error(`bootstrap row missing: ${error?.message}`);

  const refreshRes = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(
        `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`,
      ).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: data.refresh_token,
    }).toString(),
  });
  if (!refreshRes.ok) throw new Error(`Xero refresh failed: ${refreshRes.status} ${await refreshRes.text()}`);
  const tokens = await refreshRes.json();

  // Rotate bootstrap row.
  await supabase
    .from('xero_ci_bootstrap')
    .update({ refresh_token: tokens.refresh_token, rotated_at: new Date().toISOString() })
    .eq('id', 1);

  const connectionsRes = await fetch('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
  });
  const conns = (await connectionsRes.json()) as { tenantId: string; tenantType: string }[];
  const org = conns.find((c) => c.tenantType === 'ORGANISATION');
  if (!org) throw new Error('no ORGANISATION tenant visible to CI bootstrap token');

  const acctsRes = await fetch('https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22BANK%22', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'xero-tenant-id': org.tenantId,
      Accept: 'application/json',
    },
  });
  const acctsBody = (await acctsRes.json()) as { Accounts: { AccountID: string }[] };
  if (!acctsBody.Accounts?.length) throw new Error('no BANK accounts in Demo Company');

  return {
    accessToken: tokens.access_token,
    tenantId: org.tenantId,
    bankAccountId: acctsBody.Accounts[0].AccountID,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/xero-live/helpers/bootstrap.ts
git commit -m "test(xero-live): CI bootstrap helper that rotates and persists the refresh token"
```

### Task 9.3: Live read-path tests

**Files:**
- Create: `tests/xero-live/reads.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/xero-live/reads.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapXeroFromCi } from './helpers/bootstrap';
import { ContactsResponseSchema, InvoicesResponseSchema } from '@/lib/erp/real/xero/schemas';

describe('Xero live read path', () => {
  let accessToken: string;
  let tenantId: string;

  beforeAll(async () => {
    if (!process.env.XERO_LIVE_TESTS) {
      throw new Error('XERO_LIVE_TESTS must be set');
    }
    const boot = await bootstrapXeroFromCi();
    accessToken = boot.accessToken;
    tenantId = boot.tenantId;
  }, 60_000);

  it('GET /Contacts parses through ContactsResponseSchema', async () => {
    const res = await fetch('https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier%3D%3Dtrue', {
      headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = ContactsResponseSchema.parse(body);
    expect(parsed.Contacts).toBeDefined();
  });

  it('GET /Invoices parses through InvoicesResponseSchema', async () => {
    const res = await fetch('https://api.xero.com/api.xro/2.0/Invoices?where=Type%3D%3D%22ACCPAY%22', {
      headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, Accept: 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = InvoicesResponseSchema.parse(body);
    expect(parsed.Invoices).toBeDefined();
  });
});
```

- [ ] **Step 2: Run locally (once you have `.env.xero-live` set up)**

Run: `npm run test:xero:live`
Expected: PASS (requires a valid bootstrap token in Supabase's `xero_ci_bootstrap` row).

- [ ] **Step 3: Commit**

```bash
git add tests/xero-live/reads.test.ts
git commit -m "test(xero-live): live schema contract for /Contacts and /Invoices"
```

### Task 9.4: Live write-path test

**Files:**
- Create: `tests/xero-live/writes.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/xero-live/writes.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { bootstrapXeroFromCi } from './helpers/bootstrap';
import { PaymentsResponseSchema } from '@/lib/erp/real/xero/schemas';

// This test writes a $1 payment against a dedicated test bill in the Demo
// Company. Demo Company resets every 28 days, so no in-test cleanup is done.
// If the dedicated test bill is missing, the test skips with a clear message.

describe('Xero live write path', () => {
  let accessToken: string;
  let tenantId: string;
  let bankAccountId: string;
  let testInvoiceId: string | null = null;

  beforeAll(async () => {
    const boot = await bootstrapXeroFromCi();
    accessToken = boot.accessToken;
    tenantId = boot.tenantId;
    bankAccountId = boot.bankAccountId;

    // Look up the dedicated test bill by reference.
    const url = 'https://api.xero.com/api.xro/2.0/Invoices?where=Type%3D%3D%22ACCPAY%22%26%26Reference%3D%3D%22VANTOR_CI_TEST%22';
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, Accept: 'application/json' },
    });
    const body = await res.json() as { Invoices: { InvoiceID: string; AmountDue: number }[] };
    const available = body.Invoices?.find((inv) => inv.AmountDue > 0);
    testInvoiceId = available?.InvoiceID ?? null;
  }, 60_000);

  it('POST /Payments records a $1 payment against the test bill', async () => {
    if (!testInvoiceId) {
      console.warn('[xero-live] no available VANTOR_CI_TEST bill with remaining balance — skipping');
      return;
    }
    const res = await fetch('https://api.xero.com/api.xro/2.0/Payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'xero-tenant-id': tenantId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Invoice: { InvoiceID: testInvoiceId },
        Account: { AccountID: bankAccountId },
        Date: new Date().toISOString().slice(0, 10),
        Amount: 1.0,
        CurrencyRate: 1.0,
        Reference: `Vantor CI tx:0x${'0'.repeat(64)}`,
      }),
    });
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    const parsed = PaymentsResponseSchema.parse(body);
    expect(parsed.Payments[0].PaymentID).toBeDefined();
  });
});
```

- [ ] **Step 2: Seed the dedicated test bill in the Demo Company**

Manually (one-time) or via a separate seed script: create an ACCPAY invoice in the Xero Demo Company with Reference=`VANTOR_CI_TEST`, Total=$100, assigned to any supplier contact. The test takes $1 at a time; the Demo Company reset replenishes every 28 days. Document the seed step in `tests/xero-live/README.md`.

Create `tests/xero-live/README.md`:

```markdown
# Xero Live Test Suite

Hits Xero's Demo Company. Never runs on default `npm test`. Run via:

    npm run test:xero:live

## One-time setup

1. Log into the Xero Demo Company with the developer account.
2. Create an ACCPAY invoice:
   - Contact: any supplier (e.g., "Vantor CI Vendor")
   - Reference: `VANTOR_CI_TEST`
   - Amount: $100 USD
   - Due date: any
3. Record the refresh token from a fresh OAuth run into `xero_ci_bootstrap`:

       INSERT INTO xero_ci_bootstrap (id, refresh_token) VALUES (1, 'rt-...');

The test bill is topped up automatically by the 28-day Demo Company reset.
```

- [ ] **Step 3: Commit**

```bash
git add tests/xero-live/writes.test.ts tests/xero-live/README.md
git commit -m "test(xero-live): live Payments POST against dedicated VANTOR_CI_TEST bill"
```

### Task 9.5: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/xero-live-tests.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/xero-live-tests.yml`:

```yaml
name: Xero Live Tests

on:
  workflow_dispatch:
  schedule:
    - cron: '0 4 * * *'  # 04:00 UTC nightly

jobs:
  live:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      XERO_LIVE_TESTS: '1'
      XERO_CLIENT_ID: ${{ secrets.XERO_CLIENT_ID }}
      XERO_CLIENT_SECRET: ${{ secrets.XERO_CLIENT_SECRET }}
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Run Xero live tests
        id: live
        run: npm run test:xero:live
      - name: Open issue on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Xero live test failed on ${new Date().toISOString().slice(0,10)}`,
              labels: ['xero-live-test-failure'],
              body: `Run: ${context.payload.workflow_run?.html_url ?? context.runId}\n\nSee the logs for the failing suite.`,
            });
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/xero-live-tests.yml
git commit -m "ci(xero-live): manual + nightly workflow with auto-issue on failure"
```

### Task 9.6: Fixture recording script

**Files:**
- Create: `scripts/xero-record-fixtures.ts`
- Modify: `package.json` (add `xero:record` script)

- [ ] **Step 1: Write the script**

Create `scripts/xero-record-fixtures.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootstrapXeroFromCi } from '../tests/xero-live/helpers/bootstrap';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'xero');

function sanitize(obj: unknown): unknown {
  const replacements: Array<[RegExp, string]> = [
    [/"tenantId":\s*"[^"]+"/g, '"tenantId": "tenant-test-0001"'],
  ];
  let json = JSON.stringify(obj, null, 2);
  for (const [re, to] of replacements) json = json.replace(re, to);
  return JSON.parse(json);
}

async function main() {
  if (!process.env.XERO_CLIENT_ID || !process.env.SUPABASE_URL) {
    throw new Error('XERO_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY required in env');
  }
  const { accessToken, tenantId } = await bootstrapXeroFromCi();

  const targets: Array<{ name: string; url: string }> = [
    { name: 'contacts', url: 'https://api.xero.com/api.xro/2.0/Contacts?where=IsSupplier%3D%3Dtrue' },
    { name: 'invoices', url: 'https://api.xero.com/api.xro/2.0/Invoices?where=Type%3D%3D%22ACCPAY%22' },
    { name: 'accounts-bank', url: 'https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22BANK%22' },
  ];

  for (const t of targets) {
    const res = await fetch(t.url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'xero-tenant-id': tenantId, Accept: 'application/json' },
    });
    const body = await res.json();
    const sanitized = sanitize(body);
    const file = join(FIXTURES_DIR, `${t.name}.json`);
    writeFileSync(file, JSON.stringify(sanitized, null, 2) + '\n');
    console.log(`wrote ${file}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add the `xero:record` script**

Edit `package.json`:
```json
"xero:record": "tsx scripts/xero-record-fixtures.ts"
```

(If `tsx` is not installed, run `npm install --save-dev tsx`.)

- [ ] **Step 3: Commit**

```bash
git add scripts/xero-record-fixtures.ts package.json
git commit -m "test(xero): fixture recorder hitting Demo Company with sanitization"
```

---

## Phase 10 — Final verification + PR

### Task 10.1: Full test run and build

**Files:** None

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass, including the new Xero suites. Testcontainers-backed tests take longest; budget ~2 minutes.

- [ ] **Step 2: Run the typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: clean Next.js production build.

### Task 10.2: Manual smoke test against Demo Company

**Files:** None

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on port 3000.

- [ ] **Step 2: Walk through the connect flow in a browser**

1. Log in to Vantor locally as a test user.
2. Navigate to `/settings/erp`.
3. Click "Connect Xero".
4. Authenticate against Xero with the developer account, consent to scopes, pick Demo Company.
5. Expected: redirected to `/settings/erp?xero=connected` with the success banner.

- [ ] **Step 3: Verify erp_configurations row**

In the Supabase dashboard for dev, check `erp_configurations` for the new row: `provider=xero`, `status=active`, `xero_tenant_id` populated, `xero_bank_account_id` populated, `access_token_expires_at` ~30 min in the future.

- [ ] **Step 4: Smoke-test the read path**

Manually trigger a vendor sync via whatever endpoint or UI exists (e.g., a "Sync" button on `/settings/erp`). Verify vendors appear from the Demo Company.

### Task 10.3: Push and open PR

**Files:** None (git commands only)

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feature/xero-real-adapter`

- [ ] **Step 2: Open the PR**

Run:
```bash
gh pr create --title "feat(erp): real Xero adapter with OAuth + AP bill payments" --body "$(cat <<'EOF'
## Summary

- Replaces mock XeroMockAdapter with a production XeroRealAdapter (OAuth 2.0 + PKCE, Zod-validated responses, per-connection refresh mutex with reload-before-refresh)
- IERPAdapter contract change: `postGLEntry` → `recordBillPayment` (Xero Payments API, not Manual Journals — correct primitive for treasury↔ERP AP closeout)
- Removes dormant `/api/erp/gl-post` route + `gl_postings` table, adds `bill_payments`
- Testcontainers Postgres for Layer 2 integration tests, MSW fixture replay, separate live Layer 3 suite against Xero Demo Company (manual + nightly cron)

## Test plan

- [ ] `npm test` green (unit + integration layers)
- [ ] `npm run test:xero:live` green locally against Demo Company
- [ ] Manual connect flow at `/settings/erp` → Xero → back to Vantor
- [ ] erp_configurations row inspected for correct tenant + bank account + expiry
- [ ] One read sync against Demo Company vendors
- [ ] GitHub Actions nightly workflow dry-run via `workflow_dispatch`

Spec: docs/superpowers/specs/2026-04-11-xero-real-adapter-design.md
Plan: docs/superpowers/plans/2026-04-11-xero-real-adapter.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Post the PR URL back to the user for review**

---

## Appendix A — Spec coverage map

| Spec section | Task |
|---|---|
| §Components — `client.ts` | 6.1, 6.2, 6.3, 6.4 |
| §Components — `schemas.ts` | 4.2 |
| §Components — `mapper.ts` | 4.3 |
| §Components — `adapter.ts` | 7.1 |
| §Components — `tokens.ts` | 5.1, 5.2 |
| §Components — `errors.ts` | 4.1 |
| §Components — `authorize/route.ts` | 8.1 |
| §Components — `callback/route.ts` | 8.2 |
| §Components — Factory wire-up | 7.2 |
| §Components — Supabase migration | 1.5 |
| §IERPAdapter contract change | 1.1, 1.2 |
| §Deletions — gl-post route + table | 1.3, 1.5 |
| §Database — bill_payments + xero_ci_bootstrap | 1.5 |
| §Updates — type + mocks + seed helpers | 1.1, 1.2, 1.4 |
| §Data Flow — Flow A (connect) | 8.1, 8.2 |
| §Data Flow — Flow B (reads) | 6.1, 7.1 |
| §Data Flow — Flow C (payments) | 6.4, 7.1 |
| §Token Lifecycle — refreshAndPersist | 5.2 |
| §Token Lifecycle — in-process mutex | 5.1 |
| §Token Lifecycle — reload-before-refresh | 5.2 |
| §Token Lifecycle — persist-first invariant | 5.2 |
| §Error Handling — 8 reason codes + toUserFacing | 4.1 |
| §Testing — Layer 1 (unit) | 4.1, 4.2, 4.3, 5.1 |
| §Testing — Layer 2 (MSW + Testcontainers) | 3.1, 3.2, 5.2, 6.1–6.4, 7.1, 8.1, 8.2 |
| §Testing — Layer 3 (live) | 9.1–9.4 |
| §Testing — Fixture recorder | 9.6 |
| §Testing — CI workflow | 9.5 |
| §Hard dependency — AES encryption | 0.1 |

## Appendix B — Sentry wiring (deferred to a follow-up commit if needed)

The spec requires Sentry integration for every XeroError except `ERP_XERO_RATE_LIMITED`, plus paging for `ERP_XERO_VALIDATION`. The current plan leaves Sentry wiring implicit — `XeroError` inherits from `Error`, so Next.js' default Sentry instrumentation will capture it. A follow-up task can add explicit `Sentry.captureException(err, { tags: { reason_code: err.reason_code, ... } })` at the adapter call sites if the default auto-capture proves insufficient. Not in this plan because it does not change behavior; log triage identifies whether to add it.
