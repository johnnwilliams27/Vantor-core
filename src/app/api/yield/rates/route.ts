import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getYieldAdapter, ALL_YIELD_PROTOCOLS } from '@/lib/yield/factory';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('yield-rates', session.user.id, 30, 3600_000)) {
    return rateLimitResponse();
  }

  const rates = await Promise.all(
    ALL_YIELD_PROTOCOLS.flatMap((pid) => {
      const adapter = getYieldAdapter(pid);
      const info = adapter.getInfo();
      return info.supportedTokens.map((t) => adapter.getAPY(t));
    }),
  );

  return NextResponse.json({ data: rates });
}
