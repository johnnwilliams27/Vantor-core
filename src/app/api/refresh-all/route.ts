import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';

// Triggers all cron jobs on demand. Rate-limited to prevent abuse.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('refresh-all', session.user.id, 3, 60 * 60 * 1000)) {
    return rateLimitResponse();
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const baseUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const headers = { Authorization: `Bearer ${cronSecret}` };

  const jobs = [
    { name: 'wallets', path: '/api/cron/poll-balances' },
    { name: 'bank_accounts', path: '/api/cron/poll-bank-balances' },
    { name: 'erp', path: '/api/cron/sync-erp' },
  ];

  const results: Record<string, { ok: boolean; data?: unknown; error?: string }> = {};

  await Promise.allSettled(
    jobs.map(async ({ name, path }) => {
      try {
        const res = await fetch(`${baseUrl}${path}`, { headers });
        const body = await res.json().catch(() => null);
        results[name] = { ok: res.ok, data: body };
      } catch (err) {
        results[name] = { ok: false, error: (err as Error).message };
      }
    })
  );

  return NextResponse.json({ data: results });
}
