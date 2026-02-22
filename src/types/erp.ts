import type { ErpVendor, Invoice, ChainType, TokenSymbol } from './database';

export interface ERPCredentials {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  companyCode?: string;
  tenantId?: string;
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
