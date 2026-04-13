import type {
  IERPAdapter,
  ERPCredentials,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentPayload,
  ERPBillPaymentResult,
} from '@/types/erp';

export class NetsuiteMockAdapter implements IERPAdapter {
  provider = 'netsuite';
  private credentials: ERPCredentials;

  constructor(credentials: ERPCredentials) {
    this.credentials = credentials;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    await delay(300);
    // NetSuite uses token-based auth: account ID + consumer key/secret + token ID/secret.
    const required: Array<keyof ERPCredentials> = [
      'accountId',
      'consumerKey',
      'consumerSecret',
      'tokenId',
      'tokenSecret',
    ];
    const missing = required.filter((k) => !this.credentials[k]);
    if (missing.length) {
      return { success: false, message: `Missing NetSuite credentials: ${missing.join(', ')}` };
    }
    return { success: true, message: 'NetSuite connection successful (mock)' };
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    await delay(500);
    return [
      {
        id: 'NS-V001',
        name: 'Stratford Manufacturing',
        email: 'ap@stratfordmfg.com',
        walletAddress: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        chain: 'ethereum',
      },
      {
        id: 'NS-V002',
        name: 'Pacific Rim Distributors',
        email: 'invoices@pacificrim.net',
        walletAddress: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
      },
      {
        id: 'NS-V003',
        name: 'Atlas Engineering',
        email: 'billing@atlaseng.com',
        walletAddress: undefined,
        chain: undefined,
      },
      {
        id: 'NS-V004',
        name: 'Horizon Media Group',
        email: 'ar@horizonmedia.co',
        walletAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        chain: 'ethereum',
      },
    ];
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    await delay(600);
    const today = new Date();
    return [
      {
        id: 'NS-INV-001',
        invoiceNumber: 'NS-2024-001',
        vendorId: 'NS-V001',
        amount: 45000,
        token: 'USDC',
        chain: 'ethereum',
        description: 'Manufacturing Components Q3',
        dueDate: addDays(today, 45),
      },
      {
        id: 'NS-INV-002',
        invoiceNumber: 'NS-2024-002',
        vendorId: 'NS-V002',
        amount: 11750,
        token: 'USDC',
        chain: 'solana',
        description: 'Distribution Services April',
        dueDate: addDays(today, 10),
      },
      {
        id: 'NS-INV-003',
        invoiceNumber: 'NS-2024-003',
        vendorId: 'NS-V003',
        amount: 28000,
        token: 'USDT',
        chain: 'ethereum',
        description: 'Engineering Retainer Q2',
        dueDate: addDays(today, -10),
      },
      {
        id: 'NS-INV-004',
        invoiceNumber: 'NS-2024-004',
        vendorId: 'NS-V004',
        amount: 9500,
        token: 'USDC',
        chain: 'ethereum',
        description: 'Media Campaign March',
        dueDate: addDays(today, 5),
      },
    ];
  }

  async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
    await delay(400);
    return {
      externalPaymentId: `NS-PMT-${Date.now()}`,
      status: 'recorded',
      message: `Payment of ${payload.amount} ${payload.currency} recorded against NetSuite bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
    };
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
