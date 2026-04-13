import { describe, it, expect } from 'vitest';
import {
  xeroContactsToVendors,
  xeroInvoicesToVantorInvoices,
  xeroPaymentToBillPaymentResult,
  parseXeroDate,
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
    // DueDate in the fixture is Xero's /Date(ms+tz)/ format; mapper must
    // normalize to ISO yyyy-mm-dd so downstream doesn't see MS .NET dates.
    expect(invoices[0].dueDate).toBe('2025-05-01');
  });

  it('parseXeroDate converts /Date(ms+tz)/ to ISO, leaves ISO unchanged', () => {
    expect(parseXeroDate('/Date(1743120000000+0000)/')).toBe('2025-03-28');
    expect(parseXeroDate('/Date(1743120000000)/')).toBe('2025-03-28'); // tz optional
    expect(parseXeroDate('/Date(-1000)/')).toBe('1969-12-31');          // pre-epoch edge
    expect(parseXeroDate('2025-05-01')).toBe('2025-05-01');             // already ISO
    expect(parseXeroDate(undefined)).toBeUndefined();
    expect(parseXeroDate('')).toBeUndefined();
    expect(parseXeroDate('not a date')).toBe('not a date');             // pass-through
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
