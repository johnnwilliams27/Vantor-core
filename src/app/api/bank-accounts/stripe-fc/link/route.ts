import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { getFCAccount, getFCBalance } from '@/lib/banking/stripe-fc';
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

      // Fetch the initial balance so the account isn't stuck showing "—" in
      // the UI immediately after linking. If balance retrieval fails (e.g.
      // Stripe hasn't finished hydrating the account yet), fall back to null
      // and let a manual refresh or the nightly cron populate it — the row
      // still lands.
      let initialBalance: { current: number; currency: string } | null = null;
      try {
        const bal = await getFCBalance(mode, accountId);
        initialBalance = { current: bal.current, currency: bal.currency };
      } catch (balErr) {
        console.warn('[stripe-fc/link] initial balance fetch failed for', accountId, balErr);
      }

      await supabase.from('bank_accounts').insert({
        user_id: session.user.id,
        enterprise_id: session.user.enterprise_id,
        banking_provider: 'stripe_fc',
        stripe_fc_account_id: acc.id,
        institution_name: acc.institutionName,
        account_name: acc.displayName || 'Account',
        account_type: acc.accountType,
        currency: initialBalance?.currency ?? acc.currency ?? 'USD',
        last4: acc.last4,
        current_balance: initialBalance?.current ?? null,
        balance_currency: initialBalance?.currency ?? null,
        balance_as_of: initialBalance ? new Date().toISOString() : null,
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
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to link accounts' },
      { status: 500 },
    );
  }
}
