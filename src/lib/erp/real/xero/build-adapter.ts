import { randomUUID } from 'node:crypto';
import { XeroRealAdapter } from './adapter';
import { refreshAndPersist, type StoredCredentials, type DbQueryable } from './tokens';
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
  db: DbQueryable;
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
      trace_id: randomUUID(),
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
