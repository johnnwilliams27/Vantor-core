import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { makeXeroMswServer } from '../helpers/msw-xero';
import {
  refreshAndPersist,
  __resetMutexForTests,
  type StoredCredentials,
} from '@/lib/erp/real/xero/tokens';

// Base64 JSON shims. Production uses the real AES-GCM helpers from
// src/lib/erp/factory.ts; tests use a simpler codec so the DB fake
// is round-trippable without bringing in the crypto subsystem.
const testDecrypt = (c: string): StoredCredentials =>
  JSON.parse(Buffer.from(c, 'base64').toString('utf-8'));
const testEncrypt = (c: StoredCredentials): string =>
  Buffer.from(JSON.stringify(c)).toString('base64');

/**
 * Minimal in-memory fake of the subset of `pg.Client.query()` that
 * refreshAndPersist issues. Enough to prove correctness of reload-
 * before-refresh, invalid_grant handling, persist-retry, and concurrent
 * dedup. Full pg-level behavior (row locks, isolation) is out of scope
 * for the adapter's unit layer — that belongs to Phase 9 live tests.
 */
interface FakeRow {
  credentials: string;
  access_token_expires_at: Date;
  refresh_token_rotated_at: Date;
  status: 'active' | 'expired' | 'needs_reconnect';
}

function makeFakeDb() {
  const rows = new Map<string, FakeRow>();
  let updateFailsUntilAttempt = 0;
  let updateAttempts = 0;

  const client = {
    async query(sql: string, params: unknown[] = []): Promise<{ rowCount: number; rows: Array<Record<string, unknown>> }> {
      const [id] = params;
      if (sql.startsWith('SELECT credentials FROM erp_configurations')) {
        const row = rows.get(id as string);
        return { rowCount: row ? 1 : 0, rows: row ? [{ credentials: row.credentials }] : [] };
      }
      if (/UPDATE erp_configurations[\s\S]*credentials\s*=/i.test(sql) && !/status\s*=\s*'expired'/.test(sql) && !/status\s*=\s*'needs_reconnect'/.test(sql)) {
        updateAttempts++;
        if (updateAttempts < updateFailsUntilAttempt) {
          throw new Error(`fake-db: simulated persist failure attempt ${updateAttempts}`);
        }
        const row = rows.get(id as string);
        if (!row) return { rowCount: 0, rows: [] };
        row.credentials = params[1] as string;
        row.access_token_expires_at = params[2] as Date;
        row.refresh_token_rotated_at = new Date();
        row.status = 'active';
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE erp_configurations[\s\S]*status\s*=\s*'expired'/i.test(sql)) {
        const row = rows.get(id as string);
        if (row) row.status = 'expired';
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      if (/UPDATE erp_configurations[\s\S]*status\s*=\s*'needs_reconnect'/i.test(sql)) {
        const row = rows.get(id as string);
        if (row) row.status = 'needs_reconnect';
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      throw new Error(`fake-db: unhandled SQL: ${sql.slice(0, 120)}`);
    },
  };

  function seed(id: string, overrides: Partial<{ refresh_token: string; access_token: string; expires_at: Date }> = {}) {
    const refreshToken = overrides.refresh_token ?? 'old-refresh-token';
    const accessToken = overrides.access_token ?? 'old-access-token';
    const expiresAt = overrides.expires_at ?? new Date(Date.now() - 60_000);
    const encoded = testEncrypt({
      access_token: accessToken,
      refresh_token: refreshToken,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
    rows.set(id, {
      credentials: encoded,
      access_token_expires_at: expiresAt,
      refresh_token_rotated_at: new Date(),
      status: 'active',
    });
  }

  function get(id: string): FakeRow | undefined {
    return rows.get(id);
  }

  function setPersistFailsUntil(attempt: number) {
    updateFailsUntilAttempt = attempt;
    updateAttempts = 0;
  }

  return { client, seed, get, setPersistFailsUntil };
}

describe('refreshAndPersist', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());
  beforeEach(() => {
    __resetMutexForTests();
    server.resetHandlers();
  });

  it('persists the new refresh token and returns new access token', async () => {
    const db = makeFakeDb();
    db.seed('conn-1');

    const result = await refreshAndPersist({
      connectionId: 'conn-1',
      db: db.client as never,
      oldRefreshToken: 'old-refresh-token',
      decrypt: testDecrypt,
      encrypt: testEncrypt,
    });

    expect(result.access_token).toBe('new-access-token-rotated');
    expect(result.refresh_token).toBe('new-refresh-token-rotated');

    const row = db.get('conn-1')!;
    const creds = testDecrypt(row.credentials);
    expect(creds.refresh_token).toBe('new-refresh-token-rotated');
    expect(row.access_token_expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(row.status).toBe('active');
  });

  it('skips Xero if DB shows another process already rotated the token', async () => {
    const db = makeFakeDb();
    db.seed('conn-2', { refresh_token: 'already-rotated-by-sibling' });

    let tokenCalls = 0;
    server.close();
    const observed = makeXeroMswServer({ onCall: (ep) => { if (ep === '/connect/token') tokenCalls++; } });
    observed.listen({ onUnhandledRequest: 'error' });
    try {
      const result = await refreshAndPersist({
        connectionId: 'conn-2',
        db: db.client as never,
        oldRefreshToken: 'old-refresh-token', // stale; DB has already-rotated-by-sibling
        decrypt: testDecrypt,
        encrypt: testEncrypt,
      });
      expect(tokenCalls).toBe(0);
      expect(result.refresh_token).toBe('already-rotated-by-sibling');
    } finally {
      observed.close();
      server.listen({ onUnhandledRequest: 'error' });
    }
  });

  it('marks connection expired on invalid_grant', async () => {
    const db = makeFakeDb();
    db.seed('conn-3');

    server.close();
    const errorServer = makeXeroMswServer({
      tokenResponse: { status: 400, body: { error: 'invalid_grant' } },
    });
    errorServer.listen({ onUnhandledRequest: 'error' });
    try {
      await expect(refreshAndPersist({
        connectionId: 'conn-3',
        db: db.client as never,
        oldRefreshToken: 'old-refresh-token',
        decrypt: testDecrypt,
        encrypt: testEncrypt,
      })).rejects.toMatchObject({ reason_code: 'ERP_XERO_AUTH_EXPIRED' });

      expect(db.get('conn-3')!.status).toBe('expired');
    } finally {
      errorServer.close();
      server.listen({ onUnhandledRequest: 'error' });
    }
  });

  it('concurrent refresh calls only issue one Xero POST', async () => {
    const db = makeFakeDb();
    db.seed('conn-4');

    let tokenCalls = 0;
    server.close();
    const observed = makeXeroMswServer({ onCall: (ep) => { if (ep === '/connect/token') tokenCalls++; } });
    observed.listen({ onUnhandledRequest: 'error' });
    try {
      const [a, b] = await Promise.all([
        refreshAndPersist({
          connectionId: 'conn-4',
          db: db.client as never,
          oldRefreshToken: 'old-refresh-token',
          decrypt: testDecrypt,
          encrypt: testEncrypt,
        }),
        refreshAndPersist({
          connectionId: 'conn-4',
          db: db.client as never,
          oldRefreshToken: 'old-refresh-token',
          decrypt: testDecrypt,
          encrypt: testEncrypt,
        }),
      ]);
      expect(tokenCalls).toBe(1);
      expect(a.refresh_token).toBe(b.refresh_token);
      expect(a.refresh_token).toBe('new-refresh-token-rotated');
    } finally {
      observed.close();
      server.listen({ onUnhandledRequest: 'error' });
    }
  });

  it('retries the UPDATE up to 3 times before flipping to needs_reconnect', async () => {
    const db = makeFakeDb();
    db.seed('conn-5');
    db.setPersistFailsUntil(3); // attempts 1 and 2 fail; attempt 3 succeeds

    const result = await refreshAndPersist({
      connectionId: 'conn-5',
      db: db.client as never,
      oldRefreshToken: 'old-refresh-token',
      decrypt: testDecrypt,
      encrypt: testEncrypt,
    });

    expect(result.refresh_token).toBe('new-refresh-token-rotated');
    expect(db.get('conn-5')!.status).toBe('active');
  });

  it('flips to needs_reconnect if all 3 UPDATE attempts fail', async () => {
    const db = makeFakeDb();
    db.seed('conn-6');
    db.setPersistFailsUntil(Infinity); // every attempt fails

    await expect(refreshAndPersist({
      connectionId: 'conn-6',
      db: db.client as never,
      oldRefreshToken: 'old-refresh-token',
      decrypt: testDecrypt,
      encrypt: testEncrypt,
    })).rejects.toMatchObject({ reason_code: 'ERP_XERO_REFRESH_PERSIST_FAILURE' });

    expect(db.get('conn-6')!.status).toBe('needs_reconnect');
  });
});
