import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { createFCSession } from '@/lib/banking/stripe-fc';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const mode = getIntegrationMode(session.user.subscription_tier);

  try {
    const { clientSecret } = await createFCSession(mode);
    return NextResponse.json({ data: { clientSecret } });
  } catch (err) {
    console.error('[stripe-fc/session]', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
