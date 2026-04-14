import type {
  IERPAdapter,
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentPayload,
  ERPBillPaymentResult,
} from '@/types/erp';
import { XeroClient, type XeroClientInput } from './client';
import {
  xeroContactsToVendors,
  xeroInvoicesToVantorInvoices,
  xeroPaymentToBillPaymentResult,
} from './mapper';

export interface XeroRealAdapterInput extends XeroClientInput {
  bankAccountId: string;
}

export class XeroRealAdapter implements IERPAdapter {
  readonly provider = 'xero';
  private readonly client: XeroClient;
  private readonly bankAccountId: string;

  constructor(input: XeroRealAdapterInput) {
    this.client = new XeroClient(input);
    this.bankAccountId = input.bankAccountId;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const conns = await this.client.getConnections();
      return {
        success: conns.length > 0,
        message: conns.length > 0
          ? `Xero connection OK (${conns.length} tenant${conns.length > 1 ? 's' : ''})`
          : 'No Xero tenants visible to this connection',
      };
    } catch (err) {
      return { success: false, message: (err as Error).message };
    }
  }

  async fetchVendors(): Promise<ERPVendorRaw[]> {
    const res = await this.client.getContacts();
    return xeroContactsToVendors(res);
  }

  async fetchInvoices(): Promise<ERPInvoiceRaw[]> {
    const res = await this.client.getInvoices();
    return xeroInvoicesToVantorInvoices(res);
  }

  async recordBillPayment(payload: ERPBillPaymentPayload): Promise<ERPBillPaymentResult> {
    const res = await this.client.createPayment({
      invoiceId: payload.invoiceId,
      bankAccountId: this.bankAccountId,
      amount: payload.amount,
      paymentDate: payload.paymentDate,
      reference: `${payload.reference} tx:${payload.externalTxHash}`,
    });
    return xeroPaymentToBillPaymentResult(res);
  }
}
