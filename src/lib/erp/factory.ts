import type { IERPAdapter, ERPCredentials } from '@/types/erp';
import type { ErpProvider } from '@/types/database';
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

  // Real adapters would be loaded here when ERP_USE_MOCK=false
  // e.g. return new SAPRealAdapter(credentials);
  throw new Error(
    `Real ERP adapter for '${provider}' not implemented. Set ERP_USE_MOCK=true.`
  );
}

/** Decrypt credentials stored as AES-256-GCM hex in DB */
export function decryptCredentials(encrypted: string): ERPCredentials {
  // In production: AES-256-GCM decrypt using CREDENTIALS_ENCRYPTION_KEY
  // For now: base64/JSON passthrough (replace with real crypto in prod)
  try {
    return JSON.parse(Buffer.from(encrypted, 'base64').toString('utf-8'));
  } catch {
    throw new Error('Failed to decrypt ERP credentials');
  }
}

/** Encrypt credentials for storage */
export function encryptCredentials(credentials: ERPCredentials): string {
  // In production: AES-256-GCM encrypt
  return Buffer.from(JSON.stringify(credentials)).toString('base64');
}
