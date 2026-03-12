import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { getStablecoinPrices } from '@/lib/treasury/oracle';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { writeAuditLog } from '@/lib/audit/logger';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('treasury-prices', session.user.id, 30, 60 * 60 * 1000)) {
    return rateLimitResponse();
  }

  try {
    const { prices, source } = await getStablecoinPrices();

    await writeAuditLog({
      userId: session.user.id,
      action: 'treasury_price_refresh',
      details: { source },
    });

    return NextResponse.json({
      data: {
        ...prices,
        fetchedAt: new Date().toISOString(),
        source,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
