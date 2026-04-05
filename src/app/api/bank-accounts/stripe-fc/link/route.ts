import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { getFCAccount } from '@/lib/banking/stripe-fc';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const schema = z.object({
  accountIds: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const mode = getIntegrationMode(session.user.subscription_tier);
  const supabase = createAdminClient();

  try {
    for (const accountId of parsed.data.accountIds) {
      const acc = await getFCAccount(mode, accountId);

      await supabase.from('bank_accounts').insert({
        user_id: session.user.id,
        enterprise_id: session.user.enterprise_id,
        banking_provider: 'stripe_fc',
        stripe_fc_account_id: acc.id,
        institution_name: acc.institutionName,
        account_name: acc.displayName || 'Account',
        account_type: acc.accountType,
        currency: acc.currency || 'USD',
        last4: acc.last4,
        verified_at: new Date().toISOString(),
        is_active: true,
      });
    }

    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      action: 'bank_account_connect',
      details: { provider: 'stripe_fc', accounts_linked: parsed.data.accountIds.length },
    });

    return NextResponse.json({ data: { linked: parsed.data.accountIds.length } });
  } catch (err) {
    console.error('[stripe-fc/link]', err);
    return NextResponse.json({ error: 'Failed to link accounts' }, { status: 500 });
  }
}
