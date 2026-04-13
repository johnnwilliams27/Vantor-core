import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { loadFixture } from '../helpers/msw-xero';
import { XeroClient } from '@/lib/erp/real/xero/client';

describe('XeroClient.createPayment', () => {
  let capturedBody: unknown;
  const server = setupServer(
    http.post('https://api.xero.com/api.xro/2.0/Payments', async ({ request }) => {
      capturedBody = await request.json();
      return HttpResponse.json(loadFixture('payment'));
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { capturedBody = undefined; });
  afterAll(() => server.close());

  it('POSTs the correct shape and parses the response', async () => {
    const client = new XeroClient({
      connectionId: 'c-1',
      tenantId: 'tenant-test-0001',
      accessToken: 'ok',
      accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
      refreshToken: 'rt',
      clientId: 'ci',
      clientSecret: 'cs',
      refresh: async () => { throw new Error('nope'); },
    });

    const res = await client.createPayment({
      invoiceId: 'i0000001-0000-0000-0000-000000000001',
      bankAccountId: 'a0000001-0000-0000-0000-000000000001',
      amount: 12500,
      paymentDate: '2025-04-10',
      reference: 'Vantor-USDC tx:0xabcdef',
    });

    expect(res.Payments[0].PaymentID).toBe('p0000001-0000-0000-0000-000000000001');
    expect(capturedBody).toMatchObject({
      Invoice: { InvoiceID: 'i0000001-0000-0000-0000-000000000001' },
      Account: { AccountID: 'a0000001-0000-0000-0000-000000000001' },
      Amount: 12500,
      Reference: 'Vantor-USDC tx:0xabcdef',
    });
  });
});
