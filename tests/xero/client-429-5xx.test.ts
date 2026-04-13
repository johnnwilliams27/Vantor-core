import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { XeroClient } from '@/lib/erp/real/xero/client';

function buildClient() {
  return new XeroClient({
    connectionId: 'c-1',
    tenantId: 'tenant-test-0001',
    accessToken: 'ok',
    accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
    refreshToken: 'rt',
    clientId: 'ci',
    clientSecret: 'cs',
    refresh: async () => { throw new Error('should not refresh'); },
  });
}

describe('XeroClient 429 / 5xx', () => {
  const server = setupServer(
    http.get('https://api.xero.com/api.xro/2.0/Contacts', () =>
      new HttpResponse(JSON.stringify({}), {
        status: 429,
        headers: { 'Retry-After': '30', 'X-DayLimit-Remaining': '2500' },
      }),
    ),
    http.get('https://api.xero.com/api.xro/2.0/Invoices', () =>
      new HttpResponse(JSON.stringify({}), { status: 503 }),
    ),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers(
    http.get('https://api.xero.com/api.xro/2.0/Contacts', () =>
      new HttpResponse(JSON.stringify({}), {
        status: 429,
        headers: { 'Retry-After': '30', 'X-DayLimit-Remaining': '2500' },
      }),
    ),
    http.get('https://api.xero.com/api.xro/2.0/Invoices', () =>
      new HttpResponse(JSON.stringify({}), { status: 503 }),
    ),
  ));
  afterAll(() => server.close());

  it('throws ERP_XERO_RATE_LIMITED with parsed retry-after', async () => {
    const client = buildClient();
    await expect(client.getContacts()).rejects.toMatchObject({
      reason_code: 'ERP_XERO_RATE_LIMITED',
      fields: { retry_after_seconds: 30, daily_limit_remaining: 2500 },
    });
  });

  it('throws ERP_XERO_UPSTREAM_FAILURE on 503', async () => {
    const client = buildClient();
    await expect(client.getInvoices()).rejects.toMatchObject({
      reason_code: 'ERP_XERO_UPSTREAM_FAILURE',
    });
  });
});
