import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { getAccounts } from '@/lib/banking/belvo';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const schema = z.object({
  linkId: z.string(),
  institution: z.string(),
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

  const { linkId, institution } = parsed.data;
  const mode = getIntegrationMode(session.user.subscription_tier);
  const supabase = createAdminClient();

  try {
    const accounts = await getAccounts(mode, linkId);

    for (const acc of accounts) {
      await supabase.from('bank_accounts').insert({
        user_id: session.user.id,
        enterprise_id: session.user.enterprise_id,
        banking_provider: 'belvo',
        institution_name: acc.institution || institution,
        account_name: acc.name,
        account_type: acc.type,
        currency: acc.currency,
        last4: acc.number ? acc.number.slice(-4) : null,
        belvo_link_id: linkId,
        belvo_account_id: acc.accountId,
        verified_at: new Date().toISOString(),
        is_active: true,
      });
    }

    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      action: 'bank_account_connect',
      details: { provider: 'belvo', institution, accounts_linked: accounts.length },
    });

    return NextResponse.json({ data: { linked: accounts.length } });
  } catch (err) {
    console.error('[belvo/link]', err);
    return NextResponse.json({ error: 'Failed to link Belvo accounts' }, { status: 500 });
  }
}
