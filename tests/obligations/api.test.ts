import { describe, it, expect, vi } from 'vitest';

// Mock next-auth to return no session so the 401 path is hit without real cookies.
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(async () => null),
}));

// Mock the test-mode enterprise resolver so it never touches cookies()/headers().
vi.mock('@/lib/test-mode/enterprise', () => ({
  getEffectiveEnterpriseId: vi.fn(async (id: string | null) => id),
}));

// Mock the supabase admin client so no network calls happen if we reach it.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));

import { POST as createHandler, GET as listHandler } from '@/app/api/obligations/route';

describe('POST /api/obligations', () => {
  it('rejects unauthenticated', async () => {
    const req = new Request('http://localhost/api/obligations', {
      method: 'POST',
      body: JSON.stringify({
        label: 'x',
        direction: 'outflow',
        amount: 1,
        currency: 'USD',
        dueDate: '2026-05-01',
      }),
    });
    const res = await createHandler(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/obligations', () => {
  it('rejects unauthenticated', async () => {
    const req = new Request('http://localhost/api/obligations');
    const res = await listHandler(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});
