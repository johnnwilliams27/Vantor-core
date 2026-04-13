import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { loadFixture } from '../helpers/msw-xero';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (_table: string) => ({
      upsert: vi.fn().mockReturnValue({
        select: () => ({ single: async () => ({ data: { id: 'ec-1' }, error: null }) }),
      }),
    }),
  }),
}));

describe('/api/erp/xero/callback', () => {
  const server = setupServer(
    http.post('https://identity.xero.com/connect/token', () =>
      HttpResponse.json({
        access_token: 'ac-new',
        refresh_token: 'rt-new',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    ),
    http.get('https://api.xero.com/connections', () =>
      HttpResponse.json([
        {
          id: 'conn-1',
          tenantId: 'tenant-test-0001',
          tenantType: 'ORGANISATION',
          tenantName: 'Demo Company (Global)',
        },
      ]),
    ),
    http.get('https://api.xero.com/api.xro/2.0/Accounts', () =>
      HttpResponse.json(loadFixture('accounts-bank')),
    ),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers(
    http.post('https://identity.xero.com/connect/token', () =>
      HttpResponse.json({
        access_token: 'ac-new',
        refresh_token: 'rt-new',
        expires_in: 1800,
        token_type: 'Bearer',
      }),
    ),
    http.get('https://api.xero.com/connections', () =>
      HttpResponse.json([
        {
          id: 'conn-1',
          tenantId: 'tenant-test-0001',
          tenantType: 'ORGANISATION',
          tenantName: 'Demo Company (Global)',
        },
      ]),
    ),
    http.get('https://api.xero.com/api.xro/2.0/Accounts', () =>
      HttpResponse.json(loadFixture('accounts-bank')),
    ),
  ));
  afterAll(() => server.close());

  it('redirects to /settings/erp?xero=connected on success', async () => {
    process.env.XERO_CLIENT_ID = 'ci';
    process.env.XERO_CLIENT_SECRET = 'cs';
    process.env.XERO_REDIRECT_URI = 'https://www.example.com/api/erp/xero/callback';

    const cookiePayload = Buffer.from(JSON.stringify({
      verifier: 'v',
      state: 'S1',
      user_id: 'user-1',
      enterprise_id: 'ent-1',
    })).toString('base64url');

    const { GET } = await import('@/app/api/erp/xero/callback/route');
    const req = new Request('https://www.example.com/api/erp/xero/callback?code=auth-code&state=S1', {
      headers: { cookie: `xero_oauth=${cookiePayload}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/settings/erp?xero=connected');
  });

  it('rejects state mismatch', async () => {
    const cookiePayload = Buffer.from(JSON.stringify({
      verifier: 'v',
      state: 'S1',
      user_id: 'user-1',
      enterprise_id: 'ent-1',
    })).toString('base64url');

    const { GET } = await import('@/app/api/erp/xero/callback/route');
    const req = new Request('https://www.example.com/api/erp/xero/callback?code=auth-code&state=WRONG', {
      headers: { cookie: `xero_oauth=${cookiePayload}` },
    });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.reason_code).toBe('ERP_XERO_STATE_MISMATCH');
  });
});
