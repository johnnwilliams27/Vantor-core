import { isValidUUID, checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('bank-refresh-balance', session.user.id, 20, 60 * 60 * 1000)) {
    return rateLimitResponse();
  }

  if (!isValidUUID(params.id)) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

  const supabase = createAdminClient();

  // Verify account belongs to user
  const { data: bankAccount, error: fetchErr } = await supabase
    .from('bank_accounts')
    .select('id, banking_provider, stripe_fc_account_id')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!bankAccount) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  if (bankAccount.banking_provider === 'stripe_fc') {
    const { getFCBalance } = await import('@/lib/banking/stripe-fc');
    const { getIntegrationMode } = await import('@/lib/env/integration-mode');

    const mode = getIntegrationMode(session.user.subscription_tier);
    const balance = await getFCBalance(mode, bankAccount.stripe_fc_account_id!);

    await supabase.from('bank_accounts').update({
      current_balance: balance.current,
      balance_currency: balance.currency,
      balance_as_of: new Date().toISOString(),
    }).eq('id', bankAccount.id);

    return NextResponse.json({ data: { balance: balance.current, currency: balance.currency } });
  }

  // Belvo flow handled in Task 13, manual accounts have no auto-refresh
  return NextResponse.json({ error: 'Balance refresh not supported for this account type' }, { status: 400 });
}
