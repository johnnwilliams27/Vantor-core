// src/lib/policy/executor/executors/yield-deposit.ts
//
// Runs the held yield deposit after approvers clear it. Mirrors the
// allow_auto branch of /api/yield/deposit POST: flip row to 'pending',
// call the adapter, upsert yield_positions, finalize yield_transactions
// row to 'completed' or 'failed'.
//
// Idempotency: checks yield_transactions.status BEFORE running the
// adapter. If the row is already terminal (completed/failed/denied), we
// return the existing result without double-executing the adapter.

import type { Executor, ExecuteResult, SupabaseLike, ExecutorDenyReason } from '../types';
import type { ProposedMovement } from '../../types/movement';
import type { ApprovalRequest } from '../../approvals/types';
import { getYieldAdapter } from '@/lib/yield/factory';
import type { YieldProtocolId } from '@/lib/yield/interface';
import type { TokenSymbol } from '@/types/database';
import { markPolicyEvaluationExecuted } from '@/lib/policy/persistence/persist-evaluation';
import type { SupabaseClient } from '@supabase/supabase-js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'denied', 'cancelled']);

/**
 * Read the held yield_transactions row by movement id. Shared by both
 * execute and deny paths to guarantee idempotency.
 */
async function loadTransaction(supabase: SupabaseLike, movementId: string, enterpriseId: string) {
  const { data, error } = await (supabase.from('yield_transactions') as any)
    .select('*')
    .eq('id', movementId)
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();
  if (error) throw new Error(`loadTransaction: ${error.message}`);
  return data;
}

export const yieldDepositExecutor: Executor = {
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

    // Flip to 'pending' so the row isn't stuck at 'awaiting_approval' if
    // the adapter call takes seconds. Defense-in-depth enterprise_id.
    await (supabase.from('yield_transactions') as any)
      .update({ status: 'pending' })
      .eq('id', tx.id)
      .eq('enterprise_id', request.enterprise_id);

    // Extract adapter inputs from the movement (protocol from metadata,
    // token from amount.asset, addresses from endpoints).
    const protocol = (movement.metadata as { protocol?: string } | undefined)?.protocol
      ?? movement.destination.label
      ?? '';
    const token = movement.amount.asset;
    const amount = movement.amount.amount;
    const walletAddress = movement.source.address ?? '';
    const chain = movement.source.venue;
    const vaultAddress = movement.destination.address;

    try {
      const adapter = getYieldAdapter(protocol as YieldProtocolId);
      const result = await adapter.deposit({
        token: token as TokenSymbol,
        amount,
        walletAddress,
        chain: chain as any,
        vaultAddress,
      });

      // Upsert position (same logic as route).
      const { data: existingPos } = await (supabase.from('yield_positions') as any)
        .select('*')
        .eq('user_id', tx.user_id)
        .eq('enterprise_id', request.enterprise_id)
        .eq('protocol', protocol)
        .eq('underlying_token', token)
        .eq('is_active', true)
        .maybeSingle();

      let positionId: string;
      if (existingPos) {
        const newDeposited = parseFloat(existingPos.deposited_amount) + parseFloat(amount);
        const newCurrentValue = parseFloat(existingPos.current_value_usd) + parseFloat(amount);
        const newYieldTokenBalance = parseFloat(existingPos.yield_token_balance || '0') + result.tokensReceived;
        const newAccruedYield = Math.max(0, newCurrentValue - newDeposited);
        await (supabase.from('yield_positions') as any)
          .update({
            deposited_amount: newDeposited,
            yield_token_balance: newYieldTokenBalance,
            current_value_usd: newCurrentValue,
            accrued_yield_usd: newAccruedYield,
            apy_snapshot: result.estimatedAPY,
            last_refreshed_at: new Date().toISOString(),
          })
          .eq('id', existingPos.id);
        positionId = existingPos.id;
      } else {
        const { data: newPos, error: posErr } = await (supabase.from('yield_positions') as any)
          .insert({
            user_id: tx.user_id,
            enterprise_id: request.enterprise_id,
            protocol,
            chain,
            underlying_token: token,
            yield_token: result.yieldToken,
            yield_token_balance: result.tokensReceived,
            deposited_amount: parseFloat(amount),
            current_value_usd: parseFloat(amount),
            accrued_yield_usd: 0,
            apy_snapshot: result.estimatedAPY,
            last_refreshed_at: new Date().toISOString(),
          })
          .select()
          .single();
        if (posErr) throw new Error(posErr.message);
        positionId = newPos.id;
      }

      await (supabase.from('yield_transactions') as any)
        .update({
          position_id: positionId,
          tx_hash: result.txHash,
          status: 'completed',
          executed_at: new Date().toISOString(),
          metadata: {
            providerRef: result.providerRef,
            yieldToken: result.yieldToken,
            executed_via_approval: true,
            approval_request_id: request.id,
          },
        })
        .eq('id', tx.id)
        .eq('enterprise_id', request.enterprise_id);

      markPolicyEvaluationExecuted(supabase as SupabaseClient, {
        movementId: movement.id,
        enterpriseId: request.enterprise_id,
        executionRef: result.txHash,
      }).catch(() => {});

      return {
        status: 'completed',
        notes: {
          tx_hash: result.txHash,
          position_id: positionId,
          provider_ref: result.providerRef,
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
