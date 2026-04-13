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
