import type {
  IERPAdapter,
  ERPCredentials,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPGLPostPayload,
  ERPGLPostResult,
} from '@/types/erp';

export class QuickBooksMockAdapter implements IERPAdapter {
  provider = 'quickbooks';
  private credentials: ERPCredentials;

  constructor(credentials: ERPCredentials) {
    this.credentials = credentials;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    await delay(300);
    if (!this.credentials.clientId || !this.credentials.clientSecret) {
      return { success: false, message: 'Missing QuickBooks Client ID or Client Secret' };
    }
    return { success: true, message: 'QuickBooks connection successful (mock)' };
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    await delay(500);
    return [
      {
        id: 'QB-V001',
        name: 'Sterling Logistics',
        email: 'ap@sterlinglogistics.com',
        walletAddress: '0x8aE4B2C16d0b8eB7bE4c6A1cd6a5C7a3E6f0d2A1',
        chain: 'ethereum',
      },
      {
        id: 'QB-V002',
        name: 'Northbridge Accounting',
        email: 'invoices@northbridge.co',
        walletAddress: undefined,
        chain: undefined,
      },
      {
        id: 'QB-V003',
        name: 'Cedar Software Labs',
        email: 'billing@cedarlabs.dev',
        walletAddress: 'HdE7KjZ9pQnLq8ZnYmUvHQAzRJXk5PqWrvcW6t1bnnPd',
        chain: 'solana',
      },
    ];
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    await delay(600);
    const today = new Date();
    return [
      {
        id: 'QB-INV-001',
        invoiceNumber: 'QBO-2024-0012',
        vendorId: 'QB-V001',
        amount: 8750,
        token: 'USDC',
        chain: 'ethereum',
        description: 'Freight services — March',
        dueDate: addDays(today, 15),
      },
      {
        id: 'QB-INV-002',
        invoiceNumber: 'QBO-2024-0013',
        vendorId: 'QB-V003',
        amount: 22400,
        token: 'USDC',
        chain: 'solana',
        description: 'SaaS platform annual renewal',
        dueDate: addDays(today, 30),
      },
      {
        id: 'QB-INV-003',
        invoiceNumber: 'QBO-2024-0014',
        vendorId: 'QB-V002',
        amount: 4150,
        token: 'USDT',
        chain: 'ethereum',
        description: 'Monthly accounting retainer',
        dueDate: addDays(today, 7),
      },
    ];
  }

  async postGLEntry(payload: ERPGLPostPayload): Promise<ERPGLPostResult> {
    await delay(400);
    return {
      externalGlId: `QBO-GL-${Date.now()}`,
      status: 'posted',
      message: `GL entry posted to QuickBooks account ${payload.glAccount} (mock)`,
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
