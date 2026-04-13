// src/lib/policy/executor/executors/yield-withdraw.ts
//
// Mirror of yield-deposit executor but for withdraws. Reads the held
// yield_transactions row, runs the yield adapter withdraw, applies the
// withdrawal accounting, finalizes the row to 'completed' or 'failed'.

import type { Executor, ExecuteResult, SupabaseLike, ExecutorDenyReason } from '../types';
import type { ProposedMovement } from '../../types/movement';
import type { ApprovalRequest } from '../../approvals/types';
import { getYieldAdapter } from '@/lib/yield/factory';
import { applyWithdrawal } from '@/lib/yield/position-accounting';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'denied', 'cancelled']);

async function loadTransaction(supabase: SupabaseLike, movementId: string, enterpriseId: string) {
  const { data, error } = await (supabase.from('yield_transactions') as any)
    .select('*')
    .eq('id', movementId)
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();
  if (error) throw new Error(`loadTransaction: ${error.message}`);
  return data;
}

export const yieldWithdrawExecutor: Executor = {
  async execute(
    movement: ProposedMovement,
    request: ApprovalRequest,
    { supabase },
  ): Promise<ExecuteResult> {
    const tx = await loadTransaction(supabase, movement.id, request.enterprise_id);
    if (!tx) {
      return {
        status: 'failed',
        error: 'Yield transaction row not found for this approval.',
        notes: { movement_id: movement.id },
      };
    }
    if (TERMINAL_STATUSES.has(tx.status)) {
      return {
        status: tx.status === 'completed' ? 'completed' : 'failed',
        notes: { idempotent: true, prior_status: tx.status, tx_hash: tx.tx_hash ?? null },
      };
    }

    await (supabase.from('yield_transactions') as any)
      .update({ status: 'pending' })
      .eq('id', tx.id)
      .eq('enterprise_id', request.enterprise_id);

    const positionId = tx.position_id as string;
    if (!positionId) {
      await (supabase.from('yield_transactions') as any)
        .update({ status: 'failed', error_message: 'position_id missing on row' })
        .eq('id', tx.id)
        .eq('enterprise_id', request.enterprise_id);
      return {
        status: 'failed',
        error: 'position_id missing on row',
        notes: {},
      };
    }

    const { data: position } = await (supabase.from('yield_positions') as any)
      .select('*')
      .eq('id', positionId)
      .eq('enterprise_id', request.enterprise_id)
      .maybeSingle();

    if (!position) {
      await (supabase.from('yield_transactions') as any)
        .update({ status: 'failed', error_message: 'Yield position not found at execution time' })
        .eq('id', tx.id)
        .eq('enterprise_id', request.enterprise_id);
      return {
        status: 'failed',
        error: 'Yield position not found at execution time',
        notes: { position_id: positionId },
      };
    }

    try {
      const adapter = getYieldAdapter(position.protocol as YieldProtocolId);
      const amount = movement.amount.amount;
      const walletAddress = movement.destination.address ?? '';
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
        await (supabase.from('yield_positions') as any)
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
              closed_via_approval: request.id,
            },
          })
          .eq('id', positionId);
      } else {
        const newCurrentValue = parseFloat(position.current_value_usd) - parseFloat(amount);
        await (supabase.from('yield_positions') as any)
          .update({
            deposited_amount: withdrawResult.newDepositedAmount,
            yield_token_balance: withdrawResult.newYieldTokenBalance,
            current_value_usd: newCurrentValue,
            accrued_yield_usd: Math.max(0, newCurrentValue - withdrawResult.newDepositedAmount),
            last_refreshed_at: new Date().toISOString(),
          })
          .eq('id', positionId);
      }

      await (supabase.from('yield_transactions') as any)
        .update({
          tx_hash: result.txHash,
          status: 'completed',
          executed_at: new Date().toISOString(),
          metadata: {
            providerRef: result.providerRef,
            receivedAmount: result.receivedAmount,
            realizedYield: withdrawResult.realizedYield,
            isFullWithdrawal: withdrawResult.isFullWithdrawal,
            executed_via_approval: true,
            approval_request_id: request.id,
          },
        })
        .eq('id', tx.id)
        .eq('enterprise_id', request.enterprise_id);

      return {
        status: 'completed',
        notes: {
          tx_hash: result.txHash,
          realized_yield: withdrawResult.realizedYield,
          is_full_withdrawal: withdrawResult.isFullWithdrawal,
          executed_via_approval: true,
        },
      };
    } catch (err) {
      const msg = (err as Error).message;
      await (supabase.from('yield_transactions') as any)
        .update({ status: 'failed', error_message: msg })
        .eq('id', tx.id)
        .eq('enterprise_id', request.enterprise_id);
      return {
        status: 'failed',
        error: msg,
        notes: { executed_via_approval: true, error: msg },
      };
    }
  },

  async deny(
    movement: ProposedMovement,
    request: ApprovalRequest,
    denialReason: ExecutorDenyReason,
    { supabase },
  ): Promise<void> {
    const tx = await loadTransaction(supabase, movement.id, request.enterprise_id);
    if (!tx) return;
    if (TERMINAL_STATUSES.has(tx.status)) return;
    await (supabase.from('yield_transactions') as any)
      .update({ status: 'denied', denial_reason: denialReason })
      .eq('id', tx.id)
      .eq('enterprise_id', request.enterprise_id);
  },
};
