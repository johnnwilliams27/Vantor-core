import type { ErpVendor, Invoice, ChainType, TokenSymbol } from './database';

export interface ERPCredentials {
  /** Base URL — used by SAP and Oracle. */
  apiUrl?: string;

  /** OAuth / client credentials — SAP, Oracle, Xero, QuickBooks. */
  clientId?: string;
  clientSecret?: string;

  /** SAP-specific. */
  companyCode?: string;
  /** SAP landscape: 'dev' | 'qa' | 'prod'. */
  landscape?: string;

  /** Oracle, Xero — tenant / instance identifier. */
  tenantId?: string;

  /** NetSuite — account ID + token-based auth credentials. */
  accountId?: string;
  consumerKey?: string;
  consumerSecret?: string;
  tokenId?: string;
  tokenSecret?: string;

  /** QuickBooks Online — company realm ID. */
  realmId?: string;

  [key: string]: string | undefined;
}

export interface ERPVendorRaw {
  id: string;
  name: string;
  email?: string;
  walletAddress?: string;
  chain?: ChainType;
}

export interface ERPInvoiceRaw {
  id: string;
  invoiceNumber: string;
  vendorId: string;
  amount: number;
  token: TokenSymbol;
  chain: ChainType;
  description?: string;
  dueDate?: string;
}

export interface ERPGLPostPayload {
  invoiceId: string;
  paymentId: string;
  amount: number;
  token: TokenSymbol;
  glAccount: string;
  memo?: string;
}

export interface ERPGLPostResult {
  externalGlId: string;
  status: string;
  message?: string;
}

export interface IERPAdapter {
  provider: string;
  testConnection(): Promise<{ success: boolean; message: string }>;
  fetchVendors(): Promise<ERPVendorRaw[]>;
  fetchInvoices(): Promise<ERPInvoiceRaw[]>;
  postGLEntry(payload: ERPGLPostPayload): Promise<ERPGLPostResult>;
}
