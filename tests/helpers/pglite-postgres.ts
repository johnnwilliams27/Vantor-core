import { PGlite } from '@electric-sql/pglite';

/**
 * A tiny subset of pg.Client's surface, enough for refreshAndPersist and
 * anything else in the xero adapter that takes `db: { query(sql, params) }`.
 */
export interface TestDbClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
}

export interface TestDb {
  client: TestDbClient;
  stop(): Promise<void>;
  /** Escape hatch for multi-statement DDL or test-setup helpers. */
  exec(sql: string): Promise<void>;
}

/**
 * Spin up a disposable in-process Postgres via pglite (real Postgres compiled
 * to WASM — no Docker, no daemon), seed the minimum schema needed by the Xero
 * adapter, and return a pg-compatible client wrapper plus a stop() helper.
 *
 * This is the pglite-backed replacement for the plan's Testcontainers-based
 * Task 3.1 helper. The interface name `startTestPostgres()` is preserved so
 * existing tests can switch implementations later by changing only the import
 * path. Pglite lacks some Supabase-specific features (realtime, pgsodium,
 * auth.uid()); the bootstrap shims `auth.uid()` as a constant and skips RLS
 * policies since adapter tests run with service-role semantics anyway.
 */
export async function startTestPostgres(): Promise<TestDb> {
  const pg = new PGlite();
  await pg.waitReady;

  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;

    CREATE TABLE IF NOT EXISTS user_profiles (id UUID PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS enterprises (id UUID PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS erp_configurations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
      enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'Default',
      credentials TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT false,
      last_synced TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      xero_tenant_id TEXT,
      xero_bank_account_id TEXT,
      access_token_expires_at TIMESTAMPTZ,
      refresh_token_rotated_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'expired', 'needs_reconnect'))
    );

    CREATE TABLE IF NOT EXISTS bill_payments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
      enterprise_id UUID REFERENCES enterprises(id) ON DELETE CASCADE,
      erp_config_id UUID NOT NULL REFERENCES erp_configurations(id) ON DELETE CASCADE,
      invoice_id TEXT NOT NULL,
      external_payment_id TEXT,
      external_tx_hash TEXT NOT NULL,
      amount NUMERIC(36, 6) NOT NULL,
      currency TEXT NOT NULL,
      payment_date DATE NOT NULL,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'recorded'
        CHECK (status IN ('recorded', 'failed')),
      response_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS xero_ci_bootstrap (
      id INTEGER PRIMARY KEY DEFAULT 1,
      refresh_token TEXT NOT NULL,
      rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT xero_ci_bootstrap_singleton CHECK (id = 1)
    );
  `);

  const client: TestDbClient = {
    async query(sql, params = []) {
      const r = await pg.query<Record<string, unknown>>(sql, params);
      const rows = r.rows;
      // pglite returns `affectedRows` for UPDATE/DELETE/INSERT; for SELECT it
      // is 0. Surface pg-style `rowCount` that matches either shape.
      const affected = (r as unknown as { affectedRows?: number }).affectedRows ?? 0;
      return { rows, rowCount: Math.max(rows.length, affected) };
    },
  };

  return {
    client,
    async exec(sql) { await pg.exec(sql); },
    async stop() { await pg.close(); },
  };
}
