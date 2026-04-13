import { randomUUID } from 'node:crypto';
import { TokenResponseSchema, type TokenResponse } from './schemas';
import {
  xeroAuthExpired,
  xeroRefreshPersistFailure,
  xeroUpstreamFailure,
  xeroValidation,
} from './errors';

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

// ---------------------------------------------------------------------------
// refreshAndPersist — persist-first refresh with reload-before-refresh guard
// ---------------------------------------------------------------------------

const XERO_TOKEN_ENDPOINT = 'https://identity.xero.com/connect/token';

export interface StoredCredentials {
  access_token: string;
  refresh_token: string;
  clientId: string;
  clientSecret: string;
}

/**
 * A minimal DB surface — anything with a `query(sql, params)` returning
 * `{ rows, rowCount }` fits. Production passes a pg.Client; tests pass an
 * in-memory fake.
 */
export interface DbQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>;
}

export interface RefreshAndPersistInput {
  connectionId: string;
  db: DbQueryable;
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
        Authorization:
          'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
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
    throw xeroUpstreamFailure({
      connection_id: connectionId,
      endpoint: '/connect/token',
      trace_id: traceId,
      body_prefix: body.slice(0, 200),
    });
  }

  if (res.status >= 500) {
    throw xeroUpstreamFailure({
      connection_id: connectionId,
      endpoint: '/connect/token',
      trace_id: res.headers.get('X-Trace-Id') ?? traceId,
    });
  }

  const bodyJson: unknown = await res.json();
  const parsed = TokenResponseSchema.safeParse(bodyJson);
  if (!parsed.success) {
    throw xeroValidation({
      connection_id: connectionId,
      endpoint: '/connect/token',
      trace_id: traceId,
      zod_issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export async function refreshAndPersist(input: RefreshAndPersistInput): Promise<TokenResponse> {
  return tryAcquireRefreshLock(input.connectionId, async () => {
    const traceId = randomUUID();

    // Reload-before-refresh: read the row inside the mutex. If a sibling
    // process already rotated the refresh token, the DB's current tokens are
    // valid and we skip the Xero POST. This is the optimistic concurrency
    // guard against the rotating-refresh-token race across processes.
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
    const currentCreds = input.decrypt(reloaded.rows[0].credentials as string);
    if (currentCreds.refresh_token !== input.oldRefreshToken) {
      // Sibling rotated. Use the DB's current tokens; caller gets a fresh
      // access_token it can use immediately. expires_in is a lower bound
      // used only by the caller's cache — exact remaining TTL is in
      // erp_configurations.access_token_expires_at.
      return {
        access_token: currentCreds.access_token,
        refresh_token: currentCreds.refresh_token,
        expires_in: 1800,
      };
    }

    // Call Xero.
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
        await input.db.query(
          `UPDATE erp_configurations SET status = 'expired' WHERE id = $1`,
          [input.connectionId],
        );
      }
      throw err;
    }

    // Persist FIRST — the invariant. We have a new refresh token from Xero;
    // it is now the ONLY valid refresh token and the old one is dead. If we
    // crash between Xero rotating and us saving, we've stranded the
    // connection. Retry up to 3x with short backoff to absorb transient DB
    // hiccups, then flip to needs_reconnect if all retries fail.
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
