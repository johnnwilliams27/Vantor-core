import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getYieldAdapter } from '@/lib/yield/factory';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { updateWalletBalance, updateBankBalance } from '@/lib/balances/update-after-movement';
import { writeAuditLog } from '@/lib/audit/logger';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import type { YieldProtocolId } from '@/lib/yield/interface';

const schema = z.object({
  positionId: z.string().uuid(),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Must be positive'),
  walletAddress: z.string().min(1).max(100),
  bankAccountId: z.string().uuid(),
  fiatCurrency: z.enum(['USD', 'EUR', 'GBP']),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { positionId, amount, walletAddress, bankAccountId, fiatCurrency } = parsed.data;
  const supabase = createAdminClient();

  // 1. Fetch and validate position
  const { data: position, error: posErr } = await supabase
    .from('yield_positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (posErr || !position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  if (parseFloat(amount) > parseFloat(position.deposited_amount)) {
    return NextResponse.json({ error: 'Amount exceeds position balance' }, { status: 400 });
  }

  // 2. Validate bank account
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, institution_name, balance_currency')
    .eq('id', bankAccountId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  if (!bankAccount) {
    return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
  }

  try {
    // 3. Withdraw from yield
    const adapter = getYieldAdapter(position.protocol as YieldProtocolId);
    const withdrawResult = await adapter.withdraw({
      token: position.underlying_token,
      amount,
      walletAddress,
      chain: position.chain,
      yieldToken: position.yield_token,
    });

    // Update position
    const remaining = parseFloat(position.deposited_amount) - parseFloat(amount);
    await supabase
      .from('yield_positions')
      .update({
        deposited_amount: Math.max(0, remaining),
        current_value_usd: Math.max(0, remaining),
        is_active: remaining > 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', positionId);

    // Record yield transaction
    const { data: yieldTx } = await supabase
      .from('yield_transactions')
      .insert({
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        position_id: positionId,
        protocol: position.protocol,
        chain: position.chain,
        tx_type: 'withdraw',
        underlying_token: position.underlying_token,
        amount: parseFloat(amount),
        amount_usd: parseFloat(amount),
        tx_hash: withdrawResult.txHash,
        status: 'completed',
        executed_at: new Date().toISOString(),
        metadata: { orchestrated: true, next_step: 'offramp', fiatCurrency },
      })
      .select()
      .single();

    // 4. Off-ramp to fiat
    const mode = getIntegrationMode(session.user.subscription_tier);
    const bankingAdapter = getBankingAdapter(mode);
    const rampResult = await bankingAdapter.executeRamp({
      direction: 'offramp',
      cryptoToken: position.underlying_token,
      cryptoAmount: parseFloat(amount),
      fiatAmount: parseFloat(amount), // ~1:1 for stablecoins, adjusted by adapter for FX
      fiatCurrency,
      exchangeRate: 1,
      feeAmount: 0,
      bankAccountRef: bankAccount.id,
    });

    // Record fiat transaction
    const { data: fiatTx } = await supabase
      .from('fiat_transactions')
      .insert({
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        bank_account_id: bankAccountId,
        direction: 'offramp',
        crypto_amount: parseFloat(amount),
        crypto_token: position.underlying_token,
        fiat_amount: parseFloat(amount),
        fiat_currency: fiatCurrency,
        exchange_rate: 1,
        fee_amount: 0,
        status: rampResult.status,
        provider: 'bridge',
        provider_transaction_id: rampResult.providerTransactionId,
        settled_at: rampResult.settledAt,
      })
      .select()
      .single();

    // 5. Update balances
    if (position.wallet_id) {
      await updateWalletBalance({
        walletId: position.wallet_id,
        token: position.underlying_token,
        delta: -parseFloat(amount),
      });
    }
    await updateBankBalance({
      bankAccountId,
      delta: parseFloat(amount),
    });

    // 6. Audit
    await writeAuditLog({
      userId: session.user.id,
      action: 'yield_withdraw',
      entityType: 'yield_position',
      entityId: positionId,
      details: {
        orchestrated: true,
        amount,
        protocol: position.protocol,
        fiatCurrency,
        bankAccountId,
        yieldTxId: yieldTx?.id,
        fiatTxId: fiatTx?.id,
      },
    });

    return NextResponse.json({
      data: {
        yieldTransactionId: yieldTx?.id,
        fiatTransactionId: fiatTx?.id,
        withdrawTxHash: withdrawResult.txHash,
        rampProviderTxId: rampResult.providerTransactionId,
        fiatCurrency,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
