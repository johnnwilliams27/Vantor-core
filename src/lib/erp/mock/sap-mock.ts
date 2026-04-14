import type {
  IERPAdapter,
  ERPCredentials,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentPayload,
  ERPBillPaymentResult,
} from '@/types/erp';

export class SAPMockAdapter implements IERPAdapter {
  provider = 'sap';
  private credentials: ERPCredentials;

  constructor(credentials: ERPCredentials) {
    this.credentials = credentials;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    // Simulate slight latency
    await delay(300);
    if (!this.credentials.apiUrl || !this.credentials.clientId) {
      return { success: false, message: 'Missing required SAP credentials' };
    }
    return { success: true, message: 'SAP connection successful (mock)' };
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    await delay(500);
    return [
      {
        id: 'V001',
        name: 'Acme Corp',
        email: 'payments@acme.com',
        walletAddress: '0x742d35Cc6634C0532925a3b8D4C9C4Db3a1a8a3',
        chain: 'ethereum',
      },
      {
        id: 'V002',
        name: 'TechSupply Ltd',
        email: 'finance@techsupply.io',
        walletAddress: 'AhvdZ5bS8s7XS3JzJD2KHBwUaNJeqkNaAaXuEW2rXA1s',
        chain: 'solana',
      },
      {
        id: 'V003',
        name: 'Global Materials Inc',
        email: 'ar@globalmaterials.com',
        walletAddress: undefined,
        chain: undefined,
      },
      {
        id: 'V004',
        name: 'FastShip Logistics',
        email: 'billing@fastship.net',
        walletAddress: '0x8Ba1f109551bD432803012645Hac136c22e8',
        chain: 'ethereum',
      },
    ];
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    await delay(600);
    const today = new Date();
    return [
      {
        id: 'INV-2024-001',
        invoiceNumber: 'SAP-INV-2024-001',
        vendorId: 'V001',
        amount: 15000,
        token: 'USDC',
        chain: 'ethereum',
        description: 'Q1 Software License Fee',
        dueDate: addDays(today, 30),
      },
      {
        id: 'INV-2024-002',
        invoiceNumber: 'SAP-INV-2024-002',
        vendorId: 'V002',
        amount: 8500,
        token: 'USDC',
        chain: 'solana',
        description: 'Hardware Components Batch #42',
        dueDate: addDays(today, 15),
      },
      {
        id: 'INV-2024-003',
        invoiceNumber: 'SAP-INV-2024-003',
        vendorId: 'V003',
        amount: 22000,
        token: 'USDT',
        chain: 'ethereum',
        description: 'Raw Materials Q2',
        dueDate: addDays(today, -5), // overdue
      },
      {
        id: 'INV-2024-004',
        invoiceNumber: 'SAP-INV-2024-004',
        vendorId: 'V004',
        amount: 3200,
        token: 'USDC',
        chain: 'solana',
        description: 'Logistics Services March',
        dueDate: addDays(today, 7),
      },
    ];
  }

  async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
    await delay(400);
    return {
      externalPaymentId: `SAP-PMT-${Date.now()}`,
      status: 'recorded',
      message: `Payment of ${payload.amount} ${payload.currency} recorded against SAP bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
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
