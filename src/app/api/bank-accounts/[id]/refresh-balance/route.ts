import { isValidUUID, checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getAccountBalance } from '@/lib/banking/plaid';
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
  const { data: account, error: fetchErr } = await supabase
    .from('bank_accounts')
    .select('id, plaid_item_id, plaid_account_id')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  try {
    // Use mock access token pattern when no Plaid item linked
    const accessToken = account.plaid_item_id
      ? `access-sandbox-${account.plaid_item_id}`
      : `access-sandbox-mock-${account.id}`;
    const accountId = account.plaid_account_id ?? account.id;
    const balance = await getAccountBalance(accessToken, accountId);

    const { error: updateErr } = await supabase
      .from('bank_accounts')
      .update({
        current_balance: balance.current,
        balance_currency: balance.isoCurrencyCode,
        balance_as_of: balance.balanceAsOf,
      })
      .eq('id', params.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    await writeAuditLog({
      userId: session.user.id,
      action: 'bank_balance_refresh',
      entityType: 'bank_account',
      entityId: params.id,
      details: { balance: balance.current, currency: balance.isoCurrencyCode },
    });

    return NextResponse.json({
      data: {
        current_balance: balance.current,
        balance_currency: balance.isoCurrencyCode,
        balance_as_of: balance.balanceAsOf,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
