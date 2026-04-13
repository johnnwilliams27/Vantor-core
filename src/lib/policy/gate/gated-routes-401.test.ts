import { describe, it, expect, vi } from 'vitest';

// Smoke test for the 5 live gated routes. Proves each route module
// loads, its imports resolve, and the initial auth guard fires before
// any money-movement code runs. Pairs with the static coverage
// guardrail in `gated-routes-coverage.test.ts`:
//   - coverage: every money-movement route must import PolicyGateService
//   - this:     every gated route rejects unauthenticated POSTs
//
// Behavioral coverage of verdicts (allow_auto / require_approval /
// GateError) is deferred. The routes construct PolicyGateService
// inline with createAdminClient(), so mocking the verdict path
// requires either vi.mock'ing PolicyGateService (brittle) or a seam
// refactor — tracked as a follow-up.

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => null),
}));

// Neutralize downstream deps so a 401 path never reaches a real client.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({ select: () => ({}) }),
    rpc: () => ({}),
  })),
}));
vi.mock('@/lib/test-mode/enterprise', () => ({
  getEffectiveEnterpriseId: vi.fn(async (id: string | null) => id),
}));

describe('gated routes — 401 smoke', () => {
  it.each([
    ['/api/transfers', () => import('@/app/api/transfers/route').then((m) => m.POST)],
    ['/api/yield/deposit', () => import('@/app/api/yield/deposit/route').then((m) => m.POST)],
    ['/api/yield/withdraw', () => import('@/app/api/yield/withdraw/route').then((m) => m.POST)],
    ['/api/ramps/execute', () => import('@/app/api/ramps/execute/route').then((m) => m.POST)],
    [
      '/api/treasury/withdraw-and-offramp',
      () => import('@/app/api/treasury/withdraw-and-offramp/route').then((m) => m.POST),
    ],
    [
      '/api/scheduled-operations',
      () => import('@/app/api/scheduled-operations/route').then((m) => m.POST),
    ],
  ])('POST %s returns 401 without a session', async (path, loadHandler) => {
    const handler = await loadHandler();
    const req = new Request(`http://localhost${path}`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    const res = await handler(req as any);
    expect(res.status).toBe(401);
  });

  // Dynamic-segment route — takes { params } as a second arg, can't use
  // the generic loop above.
  it('POST /api/treasury/recommendations/:id/approve returns 401 without a session', async () => {
    const mod = await import('@/app/api/treasury/recommendations/[id]/approve/route');
    const req = new Request('http://localhost/api/treasury/recommendations/abc/approve', {
      method: 'POST',
    });
    const res = await mod.POST(req as any, { params: { id: 'abc' } } as any);
    expect(res.status).toBe(401);
  });

  // /api/integrations/slack/callback uses Slack HMAC (no NextAuth session).
  // A full smoke there would need signing-secret mocking — deferred; gate
  // wiring is still covered by the static coverage guardrail.
});
