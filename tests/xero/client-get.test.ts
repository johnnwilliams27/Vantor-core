import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { makeXeroMswServer } from '../helpers/msw-xero';
import { XeroClient } from '@/lib/erp/real/xero/client';

describe('XeroClient — basic GET', () => {
  const server = makeXeroMswServer();
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  function makeClient() {
    return new XeroClient({
      connectionId: 'c-1',
      tenantId: 'tenant-test-0001',
      accessToken: 'access-token-valid',
      accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
      refreshToken: 'rt',
      clientId: 'ci',
      clientSecret: 'cs',
      refresh: async () => { throw new Error('should not refresh'); },
    });
  }

  it('returns parsed contacts without triggering a refresh', async () => {
    const client = makeClient();
    const res = await client.getContacts();
    expect(res.Contacts.length).toBeGreaterThan(0);
    expect(res.Contacts[0].ContactID).toBe('c0000001-0000-0000-0000-000000000001');
  });

  it('returns parsed invoices', async () => {
    const client = makeClient();
    const res = await client.getInvoices();
    expect(res.Invoices[0].Type).toBe('ACCPAY');
  });

  it('returns parsed bank accounts', async () => {
    const client = makeClient();
    const res = await client.getBankAccounts();
    expect(res.Accounts[0].Type).toBe('BANK');
  });
});
