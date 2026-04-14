import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeXeroMswServer } from '../helpers/msw-xero';
import { XeroRealAdapter } from '@/lib/erp/real/xero/adapter';

const baseConnection = {
  connectionId: 'c-1',
  tenantId: 'tenant-test-0001',
  bankAccountId: 'a0000001-0000-0000-0000-000000000001',
  accessToken: 'ok',
  accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
  refreshToken: 'rt',
  clientId: 'ci',
  clientSecret: 'cs',
  refresh: async () => ({ access_token: 'nope', refresh_token: 'nope', expires_in: 1800 }),
};

describe('XeroRealAdapter', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('fetchVendors returns mapped ERPVendorRaw[]', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const vendors = await adapter.fetchVendors();
    expect(vendors.length).toBeGreaterThan(0);
    expect(vendors[0].name).toBe('Apex Consulting');
  });

  it('fetchInvoices returns mapped ERPInvoiceRaw[]', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const invoices = await adapter.fetchInvoices();
    expect(invoices[0].invoiceNumber).toBe('XERO-2025-001');
  });

  it('recordBillPayment returns externalPaymentId', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const result = await adapter.recordBillPayment({
      invoiceId: 'i0000001-0000-0000-0000-000000000001',
      amount: 12500,
      currency: 'USD',
      paymentDate: '2025-04-10',
      reference: 'Vantor-USDC',
      externalTxHash: '0xabcdef',
    });
    expect(result.externalPaymentId).toBe('p0000001-0000-0000-0000-000000000001');
    expect(result.status).toBe('recorded');
  });

  it('testConnection returns success on a real /connections hit', async () => {
    const adapter = new XeroRealAdapter(baseConnection);
    const result = await adapter.testConnection();
    expect(result.success).toBe(true);
  });
});
