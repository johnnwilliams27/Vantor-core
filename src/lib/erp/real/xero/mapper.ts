import type {
  ERPVendorRaw,
  ERPInvoiceRaw,
  ERPBillPaymentResult,
} from '@/types/erp';
import type {
  ContactsResponse,
  InvoicesResponse,
  PaymentsResponse,
} from './schemas';

export function xeroContactsToVendors(res: ContactsResponse): ERPVendorRaw[] {
  return res.Contacts
    .filter((c) => c.IsSupplier !== false) // include undefined + true
    .map((c) => ({
      id: c.ContactID,
      name: c.Name,
      email: c.EmailAddress,
      // Xero doesn't carry wallet addresses natively — left undefined,
      // matching address is a downstream concern.
      walletAddress: undefined,
      chain: undefined,
    }));
}

export function xeroInvoicesToVantorInvoices(res: InvoicesResponse): ERPInvoiceRaw[] {
  return res.Invoices
    .filter((inv) => inv.Type === 'ACCPAY')
    .map((inv) => ({
      id: inv.InvoiceID,
      invoiceNumber: inv.InvoiceNumber ?? `XERO-${inv.InvoiceID.slice(0, 8)}`,
      vendorId: inv.Contact.ContactID,
      amount: inv.Total,
      // Vantor's token + chain fields are downstream assignments — the raw
      // read from the ERP does not carry stablecoin information. Default to
      // USDC on ethereum; downstream code reassigns based on vendor mapping.
      token: 'USDC',
      chain: 'ethereum',
      description: undefined,
      dueDate: inv.DueDate,
    }));
}

export function xeroPaymentToBillPaymentResult(res: PaymentsResponse): ERPBillPaymentResult {
  const payment = res.Payments[0];
  if (!payment) {
    throw new Error('xeroPaymentToBillPaymentResult: empty Payments array');
  }
  return {
    externalPaymentId: payment.PaymentID,
    status: 'recorded',
    message: `Xero Payment ${payment.PaymentID} recorded against invoice ${payment.Invoice.InvoiceID}`,
  };
}
