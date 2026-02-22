import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getBankingAdapter } from '@/lib/banking/factory';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';

const schema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  bankAccountId: z.string().uuid(),
  cryptoToken: z.enum(['USDC', 'USDT', 'PYUSD']),
  cryptoAmount: z.number().positive(),
  fiatAmount: z.number().positive(),
  fiatCurrency: z.string().default('USD'),
  exchangeRate: z.number().positive(),
  feeAmount: z.number().min(0),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });

  const supabase = createAdminClient();

  // Verify bank account belongs to user
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, plaid_account_id, institution_name')
    .eq('id', parsed.data.bankAccountId)
    .eq('user_id', session.user.id)
    .eq('is_active', true)
    .single();

  if (!bankAccount) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });

  try {
    const adapter = getBankingAdapter();
    const result = await adapter.executeRamp({
      direction: parsed.data.direction,
      cryptoToken: parsed.data.cryptoToken,
      cryptoAmount: parsed.data.cryptoAmount,
      fiatAmount: parsed.data.fiatAmount,
      fiatCurrency: parsed.data.fiatCurrency,
      exchangeRate: parsed.data.exchangeRate,
      feeAmount: parsed.data.feeAmount,
      bankAccountRef: bankAccount.plaid_account_id ?? bankAccount.id,
    });

    const { data: fiatTx, error } = await supabase
      .from('fiat_transactions')
      .insert({
        user_id: session.user.id,
        bank_account_id: parsed.data.bankAccountId,
        direction: parsed.data.direction,
        crypto_amount: parsed.data.cryptoAmount,
        crypto_token: parsed.data.cryptoToken,
        fiat_amount: parsed.data.fiatAmount,
        fiat_currency: parsed.data.fiatCurrency,
        exchange_rate: parsed.data.exchangeRate,
        fee_amount: parsed.data.feeAmount,
        status: result.status,
        provider: 'bridge',
        provider_transaction_id: result.providerTransactionId,
        settled_at: result.settledAt,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await writeAuditLog({
      userId: session.user.id,
      action: parsed.data.direction === 'onramp' ? 'onramp_execute' : 'offramp_execute',
      entityType: 'fiat_transaction',
      entityId: fiatTx.id,
      details: {
        direction: parsed.data.direction,
        cryptoToken: parsed.data.cryptoToken,
        cryptoAmount: parsed.data.cryptoAmount,
        fiatAmount: parsed.data.fiatAmount,
        providerTxId: result.providerTransactionId,
      },
    });

    return NextResponse.json({ data: fiatTx }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
