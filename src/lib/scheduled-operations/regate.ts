// src/lib/scheduled-operations/regate.ts
//
// Re-evaluate policy at cron execution time for scheduled operations.
// Creation-time gating (see src/app/api/scheduled-operations/route.ts)
// proves the operation was allowed WHEN IT WAS SCHEDULED, but by the
// time the cron fires the underlying policy state may have drifted:
//
//   - Enterprise balances dropped below a threshold rule
//   - Forecast windows shifted so a trailing-window cap is now tripped
//   - A counterparty was added to sanctions
//   - A policy admin edited the rules in between
//
// All of those should block the scheduled op at execution time, not
// after the money has already moved. This module is the seam that
// runs that check.
//
// Design choices:
//   1. We call `evaluate()` DIRECTLY rather than going through the
//      PolicyGateService. The service creates a NEW approval_request
//      on require_approval — that's correct for API calls, but for a
//      pre-approved cron fire it would produce a dangling second
//      request that the user doesn't expect. Our contract is instead
//      to deny the scheduled op as stale and let the user re-schedule.
//   2. We reuse the same per-kind + scheduled-op mappers so the
//      movement shape is identical to creation time (modulo state
//      the params intentionally don't capture, e.g., bankAccount
//      status).
//   3. On engine unavailability we fail CLOSED — the cron should not
//      blindly execute when it can't verify policy. Caller treats
//      'engine_error' as a non-executing outcome.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  ScheduledOperation,
  SwapParams,
  BridgeParams,
  RampParams,
} from '@/types/scheduled-operations';
import {
  mapSwapToMovement,
  mapBridgeToMovement,
  mapRampToMovement,
  mapScheduledOperationToMovement,
} from '@/lib/policy/gate';
import { buildProductionEvaluate } from '@/lib/policy/gate/production-wiring';
import { GateError } from '@/lib/policy/gate';
import type { ProposedMovement } from '@/lib/policy/types/movement';

export type ReGateOutcome =
  | { ok: true; reason_codes: string[] }
  | {
      ok: false;
      reason: 'stale_reeval' | 'policy_blocked_at_execution' | 'engine_error';
      human_readable: string;
      details: Record<string, unknown>;
    };

/**
 * Rebuild the inner movement from op.params using the same shape
 * mappers the creation-time POST uses. Must be kept in sync with
 * src/app/api/scheduled-operations/route.ts as the params schema
 * evolves.
 */
function buildInnerMovement(op: ScheduledOperation): ProposedMovement {
  const ctx = {
    userId: op.user_id,
    enterpriseId: op.enterprise_id ?? '',
    fromAddress: '',
  };

  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      return mapSwapToMovement(
        {
          walletAddress: p.walletAddress,
          chain: p.chain as 'ethereum' | 'solana',
          fromToken: p.fromToken as 'USDC' | 'USDT',
          toToken: p.toToken as 'USDC' | 'USDT',
          fromAmount: p.amount,
        },
        ctx,
      );
    }
    case 'bridge': {
      const p = op.params as BridgeParams;
      return mapBridgeToMovement(
        {
          // Cron has one walletAddress field for both legs. For the gate's
          // purposes this is sufficient — policy rules typically filter
          // on chain + token + amount, not per-leg addresses.
          fromWalletAddress: p.walletAddress,
          toWalletAddress: p.walletAddress,
          fromChain: p.fromChain as 'ethereum' | 'solana',
          toChain: p.toChain as 'ethereum' | 'solana',
          token: p.token as 'USDC' | 'USDT',
          amount: p.amount,
        },
        ctx,
      );
    }
    case 'ramp': {
      const p = op.params as RampParams;
      return mapRampToMovement(
        {
          direction: p.direction,
          cryptoToken: p.cryptoToken as 'USDC' | 'USDT',
          cryptoAmount: String(p.cryptoAmount),
          fiatCurrency: p.fiatCurrency,
          ...(p.fiatAmount !== undefined ? { fiatAmount: String(p.fiatAmount) } : {}),
          bankAccountId: p.bankAccountId,
        },
        ctx,
      );
    }
  }
}

export interface ReGateDeps {
  /** Override the supabase client for testing; defaults to createAdminClient(). */
  supabase?: SupabaseClient;
  /**
   * Override the evaluate function for testing. Defaults to the
   * production evaluator keyed on the supabase client.
   */
  evaluate?: ReturnType<typeof buildProductionEvaluate>;
}

/**
 * Re-gate a scheduled operation at execution time.
 *
 * Returns:
 *   - ok:true  → engine says allow_auto; caller should execute.
 *   - ok:false → caller must NOT call the adapter. Use `reason` to
 *     set denial_reason on the scheduled_operations row.
 */
export async function reGateAtExecution(
  op: ScheduledOperation,
  deps: ReGateDeps = {},
): Promise<ReGateOutcome> {
  if (!op.enterprise_id) {
    return {
      ok: false,
      reason: 'engine_error',
      human_readable: 'Scheduled operation has no enterprise_id.',
      details: { op_id: op.id },
    };
  }

  const supabase = (deps.supabase ?? createAdminClient()) as SupabaseClient;
  const evaluate = deps.evaluate ?? buildProductionEvaluate(supabase);

  let movement: ProposedMovement;
  try {
    const inner = buildInnerMovement(op);
    movement = mapScheduledOperationToMovement(
      { scheduledOpId: op.id, type: op.type, inner },
      {
        userId: op.user_id,
        enterpriseId: op.enterprise_id,
        fromAddress: '',
      },
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'engine_error',
      human_readable: 'Could not rebuild movement for re-evaluation.',
      details: { op_id: op.id, error: (err as Error).message },
    };
  }

  try {
    const verdict = await evaluate(movement, op.enterprise_id);

    if (verdict.verdict === 'allow_auto') {
      return { ok: true, reason_codes: verdict.reason_codes ?? [] };
    }

    if (verdict.verdict === 'require_approval') {
      // Policy now says this needs human approval — but the approvers
      // already cleared this specific scheduled op at creation time.
      // State drifted. Deny as stale; user can re-schedule if they
      // still want the movement.
      return {
        ok: false,
        reason: 'stale_reeval',
        human_readable:
          'Policy state changed between schedule and execution; the operation now requires fresh approval.',
        details: {
          op_id: op.id,
          reason_codes: verdict.reason_codes ?? [],
          chain_id: verdict.required_chain?.chain_id,
        },
      };
    }

    // block or block_hard_limit
    return {
      ok: false,
      reason: 'policy_blocked_at_execution',
      human_readable: 'Policy now blocks this movement at execution time.',
      details: {
        op_id: op.id,
        verdict: verdict.verdict,
        reason_codes: verdict.reason_codes ?? [],
      },
    };
  } catch (err) {
    if (err instanceof GateError) {
      return {
        ok: false,
        reason: 'engine_error',
        human_readable: 'Policy engine rejected the re-evaluation.',
        details: { op_id: op.id, reason_code: err.reason_code, ...(err.details as Record<string, unknown>) },
      };
    }
    return {
      ok: false,
      reason: 'engine_error',
      human_readable: 'Policy engine threw during re-evaluation.',
      details: { op_id: op.id, error: (err as Error).message },
    };
  }
}
