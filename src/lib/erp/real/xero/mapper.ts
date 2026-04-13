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

/**
 * Xero returns dates on GET endpoints in a legacy Microsoft .NET serialized
 * format — `/Date(1743120000000+0000)/` where the first integer is Unix
 * milliseconds and the optional trailing `±hhmm` is a timezone offset we
 * ignore (the ms value is always in UTC).
 *
 * Normalize to ISO 8601 yyyy-mm-dd. Passes ISO strings through unchanged so
 * the helper is idempotent against inputs that are already well-formatted
 * (e.g. hand-crafted test fixtures or future Xero responses that might flip
 * to ISO).
 */
export function parseXeroDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(input);
  if (!match) return input;
  const ms = Number(match[1]);
  if (!Number.isFinite(ms)) return input;
  return new Date(ms).toISOString().slice(0, 10);
}

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
      dueDate: parseXeroDate(inv.DueDate),
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
