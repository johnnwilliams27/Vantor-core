import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { loadFixture } from '../helpers/msw-xero';
import { XeroClient } from '@/lib/erp/real/xero/client';

function buildClient(refresh: () => Promise<{ access_token: string; refresh_token: string; expires_in: number }>) {
  return new XeroClient({
    connectionId: 'c-1',
    tenantId: 'tenant-test-0001',
    accessToken: 'old-access-token',
    accessTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 20),
    refreshToken: 'old-refresh-token',
    clientId: 'ci',
    clientSecret: 'cs',
    refresh,
  });
}

describe('XeroClient 401 handling', () => {
  let contactsCalls = 0;

  const server = setupServer(
    http.get('https://api.xero.com/api.xro/2.0/Contacts', ({ request }) => {
      contactsCalls++;
      const auth = request.headers.get('authorization');
      if (auth === 'Bearer old-access-token') {
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      return HttpResponse.json(loadFixture('contacts'));
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => { contactsCalls = 0; server.resetHandlers(
    http.get('https://api.xero.com/api.xro/2.0/Contacts', ({ request }) => {
      contactsCalls++;
      const auth = request.headers.get('authorization');
      if (auth === 'Bearer old-access-token') {
        return HttpResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      return HttpResponse.json(loadFixture('contacts'));
    }),
  ); });
  afterAll(() => server.close());

  it('refreshes and retries once on 401', async () => {
    const refresh = vi.fn(async () => ({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 1800,
    }));
    const client = buildClient(refresh);
    const res = await client.getContacts();
    expect(res.Contacts.length).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(contactsCalls).toBe(2); // original + retry
  });

  it('throws ERP_XERO_AUTH_EXPIRED if the retry also 401s', async () => {
    const refresh = vi.fn(async () => ({
      access_token: 'still-bad-token',
      refresh_token: 'new-refresh-token',
      expires_in: 1800,
    }));
    server.use(
      http.get('https://api.xero.com/api.xro/2.0/Contacts', () =>
        HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
    );
    const client = buildClient(refresh);
    await expect(client.getContacts()).rejects.toMatchObject({
      reason_code: 'ERP_XERO_AUTH_EXPIRED',
    });
  });
});
