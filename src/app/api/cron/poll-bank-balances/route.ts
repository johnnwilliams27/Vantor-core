import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getFCBalance } from '@/lib/banking/stripe-fc';

// Cross-enterprise system job: refreshes bank account balances across all enterprises.
// Authenticated via CRON_SECRET. Data isolation enforced by bank_account ownership.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: accounts, error } = await supabase
    .from('bank_accounts')
    .select('id, banking_provider, stripe_fc_account_id')
    .eq('is_active', true);

  if (error) {
    console.error('[cron/bank-balances]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!accounts?.length) {
    return NextResponse.json({ updated: 0 });
  }

  let updated = 0;

  for (const account of accounts) {
    try {
      const stripeAccountId = account.stripe_fc_account_id ?? account.id;
      const balance = await getFCBalance('live', stripeAccountId);

      const { error: updateErr } = await supabase
        .from('bank_accounts')
        .update({
          current_balance: balance.current,
          balance_currency: balance.currency,
          balance_as_of: new Date().toISOString(),
        })
        .eq('id', account.id);

      if (!updateErr) updated++;
    } catch (err) {
      console.error(`[cron/bank-balances] account ${account.id}:`, err);
    }
  }

  console.log(`[cron/bank-balances] updated=${updated} accounts=${accounts.length}`);
  return NextResponse.json({ updated, accounts: accounts.length });
}
