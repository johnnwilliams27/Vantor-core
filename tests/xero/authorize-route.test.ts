import { describe, it, expect, vi } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: async () => ({
    user: { id: 'user-1', enterprise_id: 'ent-1' },
  }),
}));
vi.mock('@/lib/auth/nextauth.config', () => ({ authOptions: {} }));

describe('/api/erp/xero/authorize', () => {
  it('redirects to Xero with the required query params', async () => {
    process.env.XERO_CLIENT_ID = 'test-ci';
    process.env.XERO_REDIRECT_URI = 'https://www.example.com/api/erp/xero/callback';
    const { GET } = await import('@/app/api/erp/xero/authorize/route');
    const res = await GET(new Request('https://www.example.com/api/erp/xero/authorize'));
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location).toContain('https://login.xero.com/identity/connect/authorize');
    expect(location).toContain('response_type=code');
    expect(location).toContain('client_id=test-ci');
    expect(location).toContain('code_challenge_method=S256');
    expect(location).toContain('scope=');
    // Granular scopes required by post-March-2026 Xero apps.
    expect(location).toContain('accounting.invoices.read');
    expect(location).toContain('accounting.payments');
    expect(location).toContain('accounting.contacts.read');
    expect(location).toContain('accounting.settings.read');

    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('xero_oauth=');
    expect(cookie).toContain('HttpOnly');
  });
});
