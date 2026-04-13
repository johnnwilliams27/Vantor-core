import { describe, it, expect } from 'vitest';
import {
  xeroContactsToVendors,
  xeroInvoicesToVantorInvoices,
  xeroPaymentToBillPaymentResult,
} from '@/lib/erp/real/xero/mapper';
import {
  ContactsResponseSchema,
  InvoicesResponseSchema,
  PaymentsResponseSchema,
} from '@/lib/erp/real/xero/schemas';
import { loadFixture } from '../helpers/msw-xero';

describe('mapper', () => {
  it('maps Xero contacts to ERPVendorRaw[], filtering non-suppliers', () => {
    const parsed = ContactsResponseSchema.parse(loadFixture('contacts'));
    const vendors = xeroContactsToVendors(parsed);
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors[0].id).toBe('c0000001-0000-0000-0000-000000000001');
    expect(vendors[0].name).toBe('Apex Consulting');
    expect(vendors[0].email).toBe('accounts@apexconsulting.co');
  });

  it('maps Xero invoices to ERPInvoiceRaw[], ACCPAY only', () => {
    const parsed = InvoicesResponseSchema.parse(loadFixture('invoices'));
    const invoices = xeroInvoicesToVantorInvoices(parsed);
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices[0].invoiceNumber).toBe('XERO-2025-001');
    expect(invoices[0].amount).toBe(12500);
  });

  it('maps Xero payment response to ERPBillPaymentResult', () => {
    const parsed = PaymentsResponseSchema.parse(loadFixture('payment'));
    const result = xeroPaymentToBillPaymentResult(parsed);
    expect(result.externalPaymentId).toBe('p0000001-0000-0000-0000-000000000001');
    expect(result.status).toBe('recorded');
  });

  it('throws if the payment response is empty', () => {
    expect(() =>
      xeroPaymentToBillPaymentResult({ Payments: [] } as never),
    ).toThrow();
  });
});
