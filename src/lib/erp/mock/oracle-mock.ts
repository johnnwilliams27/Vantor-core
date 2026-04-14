import type {
  IERPAdapter,
  ERPCredentials,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentPayload,
  ERPBillPaymentResult,
} from '@/types/erp';

export class OracleMockAdapter implements IERPAdapter {
  provider = 'oracle';
  private credentials: ERPCredentials;

  constructor(credentials: ERPCredentials) {
    this.credentials = credentials;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    await delay(350);
    if (!this.credentials.apiUrl || !this.credentials.tenantId) {
      return { success: false, message: 'Missing required Oracle credentials' };
    }
    return { success: true, message: 'Oracle connection successful (mock)' };
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    await delay(550);
    return [
      {
        id: 'ORC-V001',
        name: 'Nexus Consulting',
        email: 'invoices@nexus.consulting',
        walletAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        chain: 'solana',
      },
      {
        id: 'ORC-V002',
        name: 'Vertex Cloud Services',
        email: 'finance@vertexcloud.io',
        walletAddress: '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec',
        chain: 'ethereum',
      },
      {
        id: 'ORC-V003',
        name: 'DataBridge Analytics',
        email: 'ar@databridge.com',
        walletAddress: undefined,
        chain: undefined,
      },
    ];
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    await delay(700);
    const today = new Date();
    return [
      {
        id: 'ORC-INV-001',
        invoiceNumber: 'ORC-INV-2024-001',
        vendorId: 'ORC-V001',
        amount: 45000,
        token: 'USDC',
        chain: 'solana',
        description: 'Enterprise Consulting Services Q2',
        dueDate: addDays(today, 45),
      },
      {
        id: 'ORC-INV-002',
        invoiceNumber: 'ORC-INV-2024-002',
        vendorId: 'ORC-V002',
        amount: 12800,
        token: 'USDT',
        chain: 'ethereum',
        description: 'Cloud Infrastructure Annual',
        dueDate: addDays(today, 20),
      },
    ];
  }

  async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
    await delay(450);
    return {
      externalPaymentId: `ORC-PMT-${Date.now()}`,
      status: 'recorded',
      message: `Payment of ${payload.amount} ${payload.currency} recorded against Oracle bill ${payload.invoiceId} (mock), ref: ${payload.reference} tx:${payload.externalTxHash}`,
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
