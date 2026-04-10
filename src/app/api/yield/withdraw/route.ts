import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getYieldAdapter } from '@/lib/yield/factory';
import { applyWithdrawal } from '@/lib/yield/position-accounting';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const withdrawSchema = z.object({
  positionId: z.string().uuid(),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('withdraw from yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-withdraw', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = withdrawSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { positionId, amount, walletAddress } = parsed.data;
  const supabase = createAdminClient();

  // Fetch position
  const { data: position, error: posErr } = await supabase
    .from('yield_positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .single();

  if (posErr || !position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  if (parseFloat(amount) > parseFloat(position.current_value_usd)) {
    return NextResponse.json({ error: 'Withdrawal amount exceeds position value' }, { status: 400 });
  }

  // Create pending transaction
  const { data: tx, error: txErr } = await supabase
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
      status: 'pending',
    })
    .select()
    .single();

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });

  try {
    const adapter = getYieldAdapter(position.protocol as YieldProtocolId);
    const result = await adapter.withdraw({
      token: position.underlying_token as TokenSymbol,
      amount,
      walletAddress,
      chain: position.chain,
      yieldToken: position.yield_token,
    });

    const withdrawResult = applyWithdrawal(
      parseFloat(position.deposited_amount),
      parseFloat(position.yield_token_balance || '0'),
      parseFloat(position.current_value_usd),
      parseFloat(amount),
      result.tokensRedeemed,
    );

    if (withdrawResult.isFullWithdrawal) {
      await supabase
        .from('yield_positions')
        .update({
          is_active: false,
          deposited_amount: 0,
          yield_token_balance: 0,
          current_value_usd: 0,
          accrued_yield_usd: 0,
          metadata: {
            ...(typeof position.metadata === 'object' ? position.metadata : {}),
            realized_yield_usd: withdrawResult.realizedYield,
            closed_at: new Date().toISOString(),
          },
        })
        .eq('id', positionId);
    } else {
      const newCurrentValue = parseFloat(position.current_value_usd) - parseFloat(amount);
      await supabase
        .from('yield_positions')
        .update({
          deposited_amount: withdrawResult.newDepositedAmount,
          yield_token_balance: withdrawResult.newYieldTokenBalance,
          current_value_usd: newCurrentValue,
          accrued_yield_usd: Math.max(0, newCurrentValue - withdrawResult.newDepositedAmount),
          last_refreshed_at: new Date().toISOString(),
        })
        .eq('id', positionId);
    }

    // Update transaction to completed
    await supabase
      .from('yield_transactions')
      .update({
        tx_hash: result.txHash,
        status: 'completed',
        executed_at: new Date().toISOString(),
        metadata: {
          providerRef: result.providerRef,
          receivedAmount: result.receivedAmount,
          realizedYield: withdrawResult.realizedYield,
          isFullWithdrawal: withdrawResult.isFullWithdrawal,
        },
      })
      .eq('id', tx.id);

    await writeAuditLog({
      userId: session.user.id,
      action: 'yield_withdraw',
      entityType: 'yield_position',
      entityId: positionId,
      details: { protocol: position.protocol, token: position.underlying_token, amount, txHash: result.txHash },
    });

    return NextResponse.json({
      data: {
        transactionId: tx.id,
        ...result,
      },
    });
  } catch (err) {
    await supabase
      .from('yield_transactions')
      .update({
        status: 'failed',
        error_message: (err as Error).message,
      })
      .eq('id', tx.id);

    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
