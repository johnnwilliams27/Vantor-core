import type {
  IERPAdapter,
  ERPCredentials,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPGLPostPayload,
  ERPGLPostResult,
} from '@/types/erp';

export class XeroMockAdapter implements IERPAdapter {
  provider = 'xero';
  private credentials: ERPCredentials;

  constructor(credentials: ERPCredentials) {
    this.credentials = credentials;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    await delay(300);
    if (!this.credentials.clientId || !this.credentials.clientSecret) {
      return { success: false, message: 'Missing Xero Client ID or Client Secret' };
    }
    return { success: true, message: 'Xero connection successful (mock)' };
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    await delay(500);
    return [
      {
        id: 'XRO-V001',
        name: 'Apex Consulting',
        email: 'accounts@apexconsulting.co',
        walletAddress: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
        chain: 'ethereum',
      },
      {
        id: 'XRO-V002',
        name: 'Meridian Supplies',
        email: 'billing@meridiansupplies.com',
        walletAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        chain: 'solana',
      },
      {
        id: 'XRO-V003',
        name: 'Clearwater Services',
        email: 'finance@clearwater.io',
        walletAddress: null,
        chain: undefined,
      },
    ];
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    await delay(600);
    const today = new Date();
    return [
      {
        id: 'XRO-INV-001',
        invoiceNumber: 'XERO-2024-001',
        vendorId: 'XRO-V001',
        amount: 12500,
        token: 'USDC',
        chain: 'ethereum',
        description: 'Consulting Services Q2',
        dueDate: addDays(today, 21),
      },
      {
        id: 'XRO-INV-002',
        invoiceNumber: 'XERO-2024-002',
        vendorId: 'XRO-V002',
        amount: 6800,
        token: 'USDC',
        chain: 'solana',
        description: 'Office Supplies Batch',
        dueDate: addDays(today, 14),
      },
      {
        id: 'XRO-INV-003',
        invoiceNumber: 'XERO-2024-003',
        vendorId: 'XRO-V003',
        amount: 19200,
        token: 'USDT',
        chain: 'ethereum',
        description: 'Managed IT Services',
        dueDate: addDays(today, -3),
      },
    ];
  }

  async postGLEntry(payload: ERPGLPostPayload): Promise<ERPGLPostResult> {
    await delay(400);
    return {
      externalGlId: `XERO-GL-${Date.now()}`,
      status: 'posted',
      message: `GL entry posted to Xero account ${payload.glAccount} (mock)`,
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
