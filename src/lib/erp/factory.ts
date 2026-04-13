import type { IERPAdapter, ERPCredentials } from '@/types/erp';
import type { ErpProvider } from '@/types/database';
import { encryptJson, decryptJson } from '@/lib/crypto/envelope';
import { SAPMockAdapter } from './mock/sap-mock';
import { OracleMockAdapter } from './mock/oracle-mock';
import { XeroMockAdapter } from './mock/xero-mock';
import { NetsuiteMockAdapter } from './mock/netsuite-mock';
import { QuickBooksMockAdapter } from './mock/quickbooks-mock';

export function getERPAdapter(
  provider: ErpProvider,
  credentials: ERPCredentials
): IERPAdapter {
  const useMock = process.env.ERP_USE_MOCK === 'true';

  if (useMock) {
    switch (provider) {
      case 'sap':
        return new SAPMockAdapter(credentials);
      case 'oracle':
        return new OracleMockAdapter(credentials);
      case 'xero':
        return new XeroMockAdapter(credentials);
      case 'netsuite':
        return new NetsuiteMockAdapter(credentials);
      case 'quickbooks':
        return new QuickBooksMockAdapter(credentials);
      default:
        throw new Error(`Unknown ERP provider: ${provider}`);
    }
  }

  // Real adapters — getERPAdapter only has the credentials blob, but real
  // Xero needs the full erp_configurations row (tenant id, bank account id,
  // expiry, status). Point callers at the row-aware builder instead of
  // building a half-working adapter from partial state.
  switch (provider) {
    case 'xero':
      throw new Error(
        "Use buildXeroAdapter(row, deps) from '@/lib/erp/real/xero/build-adapter' — getERPAdapter() alone cannot build a real Xero adapter.",
      );
    default:
      throw new Error(
        `Real ERP adapter for '${provider}' not implemented. Set ERP_USE_MOCK=true.`,
      );
  }
}

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
