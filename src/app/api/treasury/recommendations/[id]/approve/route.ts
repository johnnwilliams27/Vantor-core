import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getBankingAdapter } from '@/lib/banking/factory';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();

  // Fetch and validate the recommendation
  const { data: rec, error: fetchErr } = await supabase
    .from('ai_recommendations')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!rec) return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 });
  if (rec.status !== 'pending_approval') {
    return NextResponse.json({ error: `Cannot approve recommendation with status: ${rec.status}` }, { status: 422 });
  }
  if (new Date(rec.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Recommendation has expired' }, { status: 422 });
  }
  if (rec.action === 'no_action' || !rec.recommended_amount_usd) {
    return NextResponse.json({ error: 'No action to execute' }, { status: 422 });
  }

  // Mark approved
  await supabase
    .from('ai_recommendations')
    .update({
      status: 'approved',
      approved_by: session.user.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  await writeAuditLog({
    userId: session.user.id,
    action: 'treasury_recommendation_approve',
    entityType: 'ai_recommendation',
    entityId: params.id,
    details: { action: rec.action, amount_usd: rec.recommended_amount_usd },
  });

  // Execute ramp
  try {
    const adapter = getBankingAdapter();
    const rampResult = await adapter.executeRamp({
      direction: rec.action as 'onramp' | 'offramp',
      cryptoToken: rec.stablecoin_token ?? 'USDC',
      cryptoAmount: parseFloat(rec.recommended_amount_usd),
      fiatAmount: parseFloat(rec.recommended_amount_usd),
      fiatCurrency: 'USD',
      exchangeRate: 1,
      feeAmount: 0,
      bankAccountRef: rec.bank_account_id ?? undefined,
    });

    const { data: fiatTx } = await supabase
      .from('fiat_transactions')
      .insert({
        user_id: session.user.id,
        bank_account_id: rec.bank_account_id,
        direction: rec.action,
        crypto_amount: parseFloat(rec.recommended_amount_usd),
        crypto_token: rec.stablecoin_token ?? 'USDC',
        fiat_amount: parseFloat(rec.recommended_amount_usd),
        fiat_currency: 'USD',
        exchange_rate: 1,
        fee_amount: 0,
        status: rampResult.status,
        provider: 'bridge',
        provider_transaction_id: rampResult.providerTransactionId,
        settled_at: rampResult.settledAt,
      })
      .select()
      .single();

    await supabase
      .from('ai_recommendations')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        fiat_transaction_id: fiatTx?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    await writeAuditLog({
      userId: session.user.id,
      action: 'treasury_recommendation_execute',
      entityType: 'ai_recommendation',
      entityId: params.id,
      details: {
        provider_tx_id: rampResult.providerTransactionId,
        fiat_transaction_id: fiatTx?.id,
      },
    });

    return NextResponse.json({ data: { status: 'executed', fiat_transaction_id: fiatTx?.id } });
  } catch (execErr) {
    await supabase
      .from('ai_recommendations')
      .update({
        execution_error: (execErr as Error).message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id);

    return NextResponse.json({ error: 'Execution failed: ' + (execErr as Error).message }, { status: 500 });
  }
}
