// src/lib/policy/executor/executors/fiat-ramp.ts
//
// Runs the held fiat_transactions row (on/off-ramp or withdraw-and-offramp
// combo) after approvers clear it. Mirrors the allow_auto branch of
// /api/ramps/execute POST.

import type { Executor, ExecuteResult, SupabaseLike, ExecutorDenyReason } from '../types';
import type { ProposedMovement } from '../../types/movement';
import type { ApprovalRequest } from '../../approvals/types';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { markPolicyEvaluationExecuted } from '@/lib/policy/persistence/persist-evaluation';
import type { SupabaseClient } from '@supabase/supabase-js';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'denied', 'cancelled']);

async function loadFiatTx(supabase: SupabaseLike, movementId: string, enterpriseId: string) {
  const { data, error } = await (supabase.from('fiat_transactions') as any)
    .select('*, bank_account:bank_accounts(id, stripe_fc_account_id, institution_name)')
    .eq('id', movementId)
    .eq('enterprise_id', enterpriseId)
    .maybeSingle();
  if (error) throw new Error(`loadFiatTx: ${error.message}`);
  return data;
}

export const fiatRampExecutor: Executor = {
  async execute(
    movement: ProposedMovement,
    request: ApprovalRequest,
    { supabase },
  ): Promise<ExecuteResult> {
    const tx = await loadFiatTx(supabase, movement.id, request.enterprise_id);
    if (!tx) {
      return {
        status: 'failed',
        error: 'fiat_transactions row not found for this approval.',
        notes: { movement_id: movement.id },
      };
    }
    if (TERMINAL_STATUSES.has(tx.status)) {
      return {
        status: tx.status === 'completed' ? 'completed' : 'failed',
        notes: { idempotent: true, prior_status: tx.status, provider_tx_id: tx.provider_transaction_id ?? null },
      };
    }

    await (supabase.from('fiat_transactions') as any)
      .update({ status: 'pending' })
      .eq('id', tx.id)
      .eq('enterprise_id', request.enterprise_id);

    try {
      // subscription_tier isn't on the request; we have to fetch the
      // creator's tier to pick the right integration mode. Defaults to
      // 'sandbox' if lookup fails (safest for ramp — sandbox will not
      // move real money).
      let tier: string | null = null;
      if (request.created_by) {
        const { data: user } = await (supabase.from('user_profiles') as any)
          .select('subscription_tier')
          .eq('id', request.created_by)
          .maybeSingle();
        tier = user?.subscription_tier ?? null;
      }
      const mode = getIntegrationMode(tier ?? 'lite');
      const adapter = getBankingAdapter(mode);

      const bankAccountRef = tx.bank_account?.stripe_fc_account_id ?? tx.bank_account_id;
      const result = await adapter.executeRamp({
        direction: tx.direction,
        cryptoToken: tx.crypto_token,
        cryptoAmount: parseFloat(tx.crypto_amount),
        fiatAmount: parseFloat(tx.fiat_amount),
        fiatCurrency: tx.fiat_currency,
        exchangeRate: parseFloat(tx.exchange_rate ?? '1'),
        feeAmount: parseFloat(tx.fee_amount ?? '0'),
        bankAccountRef,
      });

      await (supabase.from('fiat_transactions') as any)
        .update({
          status: result.status,
          provider_transaction_id: result.providerTransactionId,
          settled_at: result.settledAt,
        })
        .eq('id', tx.id)
        .eq('enterprise_id', request.enterprise_id);

      markPolicyEvaluationExecuted(supabase as SupabaseClient, {
        movementId: movement.id,
        enterpriseId: request.enterprise_id,
        executionRef: result.providerTransactionId ?? null,
      }).catch(() => {});

      return {
        status: result.status === 'completed' ? 'completed' : 'pending',
        notes: {
          provider_tx_id: result.providerTransactionId,
          settled_at: result.settledAt,
          provider_status: result.status,
          executed_via_approval: true,
        },
      };
    } catch (err) {
      const msg = (err as Error).message;
      await (supabase.from('fiat_transactions') as any)
        .update({ status: 'failed' })
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
    const tx = await loadFiatTx(supabase, movement.id, request.enterprise_id);
    if (!tx) return;
    if (TERMINAL_STATUSES.has(tx.status)) return;
    await (supabase.from('fiat_transactions') as any)
      .update({ status: 'denied', denial_reason: denialReason })
      .eq('id', tx.id)
      .eq('enterprise_id', request.enterprise_id);
  },
};
