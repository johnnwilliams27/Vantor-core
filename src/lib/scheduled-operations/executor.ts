import { createAdminClient } from '@/lib/supabase/admin';
import { getBankingAdapter } from '@/lib/banking/factory';
import { writeAuditLog } from '@/lib/audit/logger';
import { NotificationService } from '@/lib/notifications/service';
import { reGateAtExecution, type ReGateOutcome } from './regate';

const SCHEDULED_OP_ROUTE: Record<string, string> = {
  swap: '/swaps',
  bridge: '/bridges',
  ramp: '/ramps',
};

/** Resolve the user's real enterprise_id (not test-mode) for notifications */
async function getRealEnterpriseId(userId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('enterprise_id')
    .eq('id', userId)
    .single();
  return data?.enterprise_id ?? null;
}
import { actionNotificationEmail, alertEmail } from '@/lib/notifications/email-templates';
import {
  updateBalancesAfterSwap,
  updateWalletBalance,
  updateBalancesAfterRamp,
} from '@/lib/balances/update-after-movement';
import { recordUsageFee } from '@/lib/billing/usage';
import { isTestMode } from '@/lib/test-mode/helpers';
import { calculateDeviationBps, extractRate } from '@/lib/scheduled-operations/tolerances';
import type {
  ScheduledOperation,
  SwapParams,
  BridgeParams,
  RampParams,
  ScheduledMetadata,
} from '@/types/scheduled-operations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scheduledMeta(
  originalRate: number,
  executedRate: number,
  deviationBps: number,
  scheduledFor: string,
): ScheduledMetadata {
  return {
    original_rate: String(originalRate),
    executed_rate: String(executedRate),
    deviation_bps: deviationBps,
    scheduled_for: scheduledFor,
  };
}

async function markStatus(
  id: string,
  status: ScheduledOperation['status'],
  extra: Record<string, unknown> = {},
) {
  const supabase = createAdminClient();
  await supabase
    .from('scheduled_operations')
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq('id', id);
}

/**
 * Shared handler for the "re-gate denied this op at execution time"
 * branch. Both executeScheduledOperation and approveAndExecute use it.
 * Marks the row denied, writes audit, notifies the user. Never throws.
 */
async function handleReGateDenial(
  op: ScheduledOperation,
  outcome: Extract<ReGateOutcome, { ok: false }>,
  realEnterpriseId: string | null,
): Promise<void> {
  // Truncate the reason to fit the 200-char denial_reason CHECK constraint.
  const denialReason = outcome.reason.slice(0, 200);
  await markStatus(op.id, 'denied', {
    denial_reason: denialReason,
    error_message: outcome.human_readable,
  });

  await writeAuditLog({
    userId: op.user_id,
    enterpriseId: op.enterprise_id ?? undefined,
    action: 'scheduled_operation_blocked' as any,
    entityType: 'scheduled_operation',
    entityId: op.id,
    details: {
      type: op.type,
      regate_reason: outcome.reason,
      ...outcome.details,
    },
  });

  if (op.enterprise_id) {
    const deniedEmailHtml = alertEmail({
      title: 'Scheduled Operation Denied by Policy',
      description: outcome.human_readable,
      ctaLabel: 'Review Operation',
      ctaHref: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
      severity: outcome.reason === 'engine_error' ? 'warning' : 'error',
    });

    NotificationService.notify({
      eventType: 'scheduled_operation_failed',
      enterpriseId: realEnterpriseId ?? op.enterprise_id,
      title: 'Scheduled Operation Denied by Policy',
      body: outcome.human_readable,
      link: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
      metadata: {
        operationId: op.id,
        operationType: op.type,
        regate_reason: outcome.reason,
        origin: 'scheduled_operation',
        _emailSubject: 'Scheduled Operation Denied by Policy',
        _emailHtml: deniedEmailHtml,
      },
      actorId: op.user_id,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Swap execution
// ---------------------------------------------------------------------------

async function executeSwapOp(
  op: ScheduledOperation,
  params: SwapParams,
  quote: Record<string, unknown>,
  meta: ScheduledMetadata,
) {
  const adapter = getBankingAdapter('live');
  const supabase = createAdminClient();

  const result = await adapter.executeSwap({
    chain: params.chain,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.amount,
    toAmount: quote.toAmount as string,
    walletAddress: params.walletAddress,
    quoteData: (quote.quoteData as Record<string, unknown>) ?? {},
  });

  const { data: swap, error } = await supabase
    .from('swaps')
    .insert({
      user_id: op.user_id,
      enterprise_id: op.enterprise_id,
      wallet_id: params.walletId,
      chain: params.chain,
      from_token: params.fromToken,
      to_token: params.toToken,
      from_amount: params.amount,
      to_amount: quote.toAmount as string,
      tx_hash: result.txHash ?? null,
      status: result.txHash ? 'completed' : 'pending',
      quote_data: quote,
      executed_at: new Date().toISOString(),
      scheduled_operation_id: op.id,
      scheduled_metadata: meta,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to insert swap: ${error.message}`);

  if (!isTestMode()) {
    await recordUsageFee({
      enterpriseId: op.enterprise_id!,
      transactionType: 'swap',
      transactionId: swap.id,
      notionalAmountUsd: parseFloat(params.amount),
      collectedVia: 'bridge',
    });
  }

  await updateBalancesAfterSwap({
    walletId: params.walletId,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: parseFloat(params.amount),
    toAmount: parseFloat(quote.toAmount as string),
  });

  return { txHash: result.txHash, recordId: swap.id };
}

// ---------------------------------------------------------------------------
// Bridge execution
// ---------------------------------------------------------------------------

async function executeBridgeOp(
  op: ScheduledOperation,
  params: BridgeParams,
  quote: Record<string, unknown>,
  meta: ScheduledMetadata,
) {
  const adapter = getBankingAdapter('live');
  const supabase = createAdminClient();

  const result = await adapter.executeBridge({
    token: params.token,
    amount: params.amount,
    fromChain: params.fromChain,
    toChain: params.toChain,
    walletAddress: params.walletAddress,
    quoteData: (quote.quoteData as Record<string, unknown>) ?? {},
  });

  const bridgeFee = parseFloat((quote.bridgeFee as string) ?? '0');
  const receivedAmount = (parseFloat(params.amount) - bridgeFee).toFixed(6);

  const { data: bridge, error } = await supabase
    .from('bridge_transfers')
    .insert({
      user_id: op.user_id,
      enterprise_id: op.enterprise_id,
      from_wallet_id: params.fromWalletId,
      to_wallet_id: params.toWalletId,
      token: params.token,
      amount: parseFloat(params.amount),
      received_amount: parseFloat(receivedAmount),
      bridge_fee: bridgeFee,
      from_chain: params.fromChain,
      to_chain: params.toChain,
      provider: 'bridge',
      tx_hash: result.txHash,
      status: result.status === 'completed' ? 'completed' : 'pending',
      estimated_arrival_minutes: result.estimatedArrivalMinutes,
      metadata: quote,
      executed_at: new Date().toISOString(),
      scheduled_operation_id: op.id,
      scheduled_metadata: meta,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to insert bridge: ${error.message}`);

  if (!isTestMode()) {
    await recordUsageFee({
      enterpriseId: op.enterprise_id!,
      transactionType: 'bridge',
      transactionId: bridge.id,
      notionalAmountUsd: parseFloat(params.amount),
      collectedVia: 'bridge',
    });
  }

  await updateWalletBalance({
    walletId: params.fromWalletId,
    token: params.token,
    delta: -parseFloat(params.amount),
  });

  await updateWalletBalance({
    walletId: params.toWalletId,
    token: params.token,
    delta: parseFloat(receivedAmount),
  });

  return { txHash: result.txHash, recordId: bridge.id };
}

// ---------------------------------------------------------------------------
// Ramp execution
// ---------------------------------------------------------------------------

async function executeRampOp(
  op: ScheduledOperation,
  params: RampParams,
  quote: Record<string, unknown>,
  meta: ScheduledMetadata,
) {
  const adapter = getBankingAdapter('live');
  const supabase = createAdminClient();

  // Look up bank account for provider ref
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id, stripe_fc_account_id')
    .eq('id', params.bankAccountId)
    .single();

  const result = await adapter.executeRamp({
    direction: params.direction,
    cryptoToken: params.cryptoToken,
    cryptoAmount: params.cryptoAmount,
    fiatAmount: (quote.fiatAmount as number) ?? params.fiatAmount ?? 0,
    fiatCurrency: params.fiatCurrency,
    exchangeRate: quote.exchangeRate as number,
    feeAmount: (quote.feeAmount as number) ?? 0,
    bankAccountRef: bankAccount?.stripe_fc_account_id ?? bankAccount?.id,
  });

  const { data: fiatTx, error } = await supabase
    .from('fiat_transactions')
    .insert({
      user_id: op.user_id,
      enterprise_id: op.enterprise_id,
      bank_account_id: params.bankAccountId,
      direction: params.direction,
      crypto_amount: params.cryptoAmount,
      crypto_token: params.cryptoToken,
      fiat_amount: (quote.fiatAmount as number) ?? params.fiatAmount ?? 0,
      fiat_currency: params.fiatCurrency,
      exchange_rate: quote.exchangeRate as number,
      fee_amount: (quote.feeAmount as number) ?? 0,
      status: result.status,
      provider: 'bridge',
      provider_transaction_id: result.providerTransactionId,
      settled_at: result.settledAt,
      scheduled_operation_id: op.id,
      scheduled_metadata: meta,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to insert fiat_transaction: ${error.message}`);

  if (!isTestMode()) {
    await recordUsageFee({
      enterpriseId: op.enterprise_id!,
      transactionType: 'ramp',
      transactionId: fiatTx.id,
      notionalAmountUsd: (quote.fiatAmount as number) ?? params.fiatAmount ?? 0,
      collectedVia: 'bridge',
    });
  }

  // Find wallet to update crypto balance
  let walletId = params.walletId;
  if (!walletId) {
    const { data: userWallet } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', op.user_id)
      .eq('enterprise_id', op.enterprise_id!)
      .limit(1)
      .maybeSingle();
    walletId = userWallet?.id;
  }

  await updateBalancesAfterRamp({
    direction: params.direction,
    walletId: walletId ?? null,
    bankAccountId: params.bankAccountId,
    token: params.cryptoToken,
    cryptoAmount: params.cryptoAmount,
    fiatAmount: (quote.fiatAmount as number) ?? params.fiatAmount ?? 0,
  });

  return { providerTxId: result.providerTransactionId, recordId: fiatTx.id };
}

// ---------------------------------------------------------------------------
// Re-quote helper
// ---------------------------------------------------------------------------

async function fetchQuote(
  op: ScheduledOperation,
): Promise<Record<string, unknown>> {
  const adapter = getBankingAdapter('live');

  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      const q = await adapter.getSwapQuote({
        chain: p.chain,
        fromToken: p.fromToken,
        toToken: p.toToken,
        amount: p.amount,
        slippageBps: p.slippageBps,
        walletAddress: p.walletAddress,
      });
      return q as unknown as Record<string, unknown>;
    }
    case 'bridge': {
      const p = op.params as BridgeParams;
      const q = await adapter.getBridgeQuote({
        token: p.token,
        amount: p.amount,
        fromChain: p.fromChain,
        toChain: p.toChain,
        walletAddress: p.walletAddress,
      });
      return q as unknown as Record<string, unknown>;
    }
    case 'ramp': {
      const p = op.params as RampParams;
      const q = await adapter.getRampQuote({
        direction: p.direction,
        cryptoToken: p.cryptoToken as 'USDC' | 'USDT',
        fiatCurrency: p.fiatCurrency,
        cryptoAmount: p.cryptoAmount,
      });
      return q as unknown as Record<string, unknown>;
    }
    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

// ---------------------------------------------------------------------------
// Execute the right type
// ---------------------------------------------------------------------------

async function executeByType(
  op: ScheduledOperation,
  quote: Record<string, unknown>,
  meta: ScheduledMetadata,
) {
  switch (op.type) {
    case 'swap':
      return executeSwapOp(op, op.params as SwapParams, quote, meta);
    case 'bridge':
      return executeBridgeOp(op, op.params as BridgeParams, quote, meta);
    case 'ramp':
      return executeRampOp(op, op.params as RampParams, quote, meta);
    default:
      throw new Error(`Unknown operation type: ${op.type}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Called by the cron job to execute a due scheduled operation.
 * Re-quotes, checks tolerance, and either executes or flags for approval.
 */
export async function executeScheduledOperation(
  op: ScheduledOperation,
): Promise<{ executed: boolean; flagged?: boolean; error?: string }> {
  const supabase = createAdminClient();
  const realEnterpriseId = await getRealEnterpriseId(op.user_id);

  // Mark as processing
  await markStatus(op.id, 'processing');

  try {
    // Re-quote at current market rate
    const freshQuote = await fetchQuote(op);

    // Calculate deviation from the initial quote
    const originalRate = extractRate(op.type, op.initial_quote);
    const currentRate = extractRate(op.type, freshQuote);
    const deviationBps = calculateDeviationBps(originalRate, currentRate);

    // Store the execution quote and deviation
    await supabase
      .from('scheduled_operations')
      .update({
        execution_quote: freshQuote,
        deviation_bps: deviationBps,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    // Check tolerance
    if (deviationBps > op.tolerance_bps) {
      // Exceeds tolerance — flag for user authorization
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await markStatus(op.id, 'awaiting_authorization', { expires_at: expiresAt });

      await writeAuditLog({
        userId: op.user_id,
        action: 'scheduled_operation_flagged' as any,
        entityType: 'scheduled_operation',
        entityId: op.id,
        details: {
          type: op.type,
          deviation_bps: deviationBps,
          tolerance_bps: op.tolerance_bps,
          original_rate: originalRate,
          current_rate: currentRate,
        },
      });

      if (op.enterprise_id) {
        const flaggedEmailHtml = alertEmail({
          title: 'Scheduled Operation Flagged',
          description: `A scheduled ${op.type} exceeded the rate tolerance (${deviationBps}bps vs ${op.tolerance_bps}bps allowed) and requires your authorization before executing.`,
          ctaLabel: 'Review Operation',
          ctaHref: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
          severity: 'warning',
        });

        await NotificationService.notify({
          eventType: 'scheduled_operation_flagged',
          enterpriseId: realEnterpriseId ?? op.enterprise_id!,
          title: 'Scheduled Operation Needs Approval',
          body: `Scheduled ${op.type} flagged — rate deviation ${deviationBps}bps exceeds ${op.tolerance_bps}bps tolerance`,
          link: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
          metadata: {
            operationId: op.id,
            operationType: op.type,
            origin: 'scheduled_operation',
            _emailSubject: 'Scheduled Operation Flagged — Authorization Required',
            _emailHtml: flaggedEmailHtml,
          },
          actorId: op.user_id,
        }).catch(() => {});
      }

      return { executed: false, flagged: true };
    }

    // Within tolerance — but before handing to the adapter, re-gate
    // against current policy state. Approvers signed off at CREATE time;
    // if balances / forecasts / sanctions / rules have drifted since, we
    // must not silently execute on stale approval. See regate.ts.
    const regateOutcome = await reGateAtExecution(op);
    if (!regateOutcome.ok) {
      await handleReGateDenial(op, regateOutcome, realEnterpriseId);
      return { executed: false, error: regateOutcome.human_readable };
    }

    const meta = scheduledMeta(originalRate, currentRate, deviationBps, op.scheduled_for);
    const result = await executeByType(op, freshQuote, meta);

    await markStatus(op.id, 'completed', {
      executed_at: new Date().toISOString(),
      tx_hash: (result as any).txHash ?? null,
    });

    await writeAuditLog({
      userId: op.user_id,
      action: 'scheduled_operation_execute' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: {
        type: op.type,
        deviation_bps: deviationBps,
        record_id: result.recordId,
      },
    });

    if (op.enterprise_id) {
      const opLabel = op.type.charAt(0).toUpperCase() + op.type.slice(1);
      const eventType = `scheduled_${op.type}_executed` as 'scheduled_swap_executed' | 'scheduled_bridge_executed' | 'scheduled_ramp_executed';
      const params = op.params as unknown as Record<string, unknown>;

      const details: { label: string; value: string }[] = [
        { label: 'Type', value: opLabel },
        { label: 'Rate Deviation', value: `${deviationBps}bps` },
      ];
      if (op.type === 'swap') {
        details.push({ label: 'From', value: `${params.amount} ${params.fromToken}` });
        details.push({ label: 'To', value: String(params.toToken) });
      } else if (op.type === 'bridge') {
        details.push({ label: 'Amount', value: `${params.amount} ${params.token}` });
        details.push({ label: 'Route', value: `${params.fromChain} → ${params.toChain}` });
      } else if (op.type === 'ramp') {
        details.push({ label: 'Direction', value: String(params.direction) });
        details.push({ label: 'Amount', value: `${params.cryptoAmount} ${params.cryptoToken}` });
      }

      const executedEmailHtml = actionNotificationEmail({
        title: `Scheduled ${opLabel} Executed`,
        details,
        ctaLabel: `View ${opLabel}`,
        ctaHref: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
        scheduledDeviation: { toleranceBps: op.tolerance_bps, actualBps: deviationBps },
      });

      NotificationService.notify({
        eventType,
        enterpriseId: realEnterpriseId ?? op.enterprise_id!,
        title: `Scheduled ${opLabel} Executed`,
        body: `Scheduled ${op.type} completed with ${deviationBps}bps deviation`,
        link: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
        metadata: {
          operationId: op.id,
          recordId: result.recordId,
          origin: 'scheduled_operation',
          _emailSubject: `Scheduled ${opLabel} Executed`,
          _emailHtml: executedEmailHtml,
        },
        actorId: op.user_id,
      }).catch(() => {});
    }

    return { executed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStatus(op.id, 'failed', { error_message: message });

    if (op.enterprise_id) {
      const failedEmailHtml = alertEmail({
        title: 'Scheduled Operation Failed',
        description: `A scheduled ${op.type} operation failed to execute. Error: ${message}`,
        ctaLabel: 'View Details',
        ctaHref: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
        severity: 'error',
      });

      NotificationService.notify({
        eventType: 'scheduled_operation_failed',
        enterpriseId: realEnterpriseId ?? op.enterprise_id!,
        title: 'Scheduled Operation Failed',
        body: `Scheduled ${op.type} failed: ${message}`,
        link: SCHEDULED_OP_ROUTE[op.type] ?? '/transactions',
        metadata: {
          operationId: op.id,
          operationType: op.type,
          error: message,
          origin: 'scheduled_operation',
          _emailSubject: 'Scheduled Operation Failed',
          _emailHtml: failedEmailHtml,
        },
        actorId: op.user_id,
      }).catch(() => {});
    }

    return { executed: false, error: message };
  }
}

/**
 * Called when a user approves a flagged operation.
 * Fetches a fresh quote and executes at current market rate regardless of deviation.
 */
export async function approveAndExecute(
  op: ScheduledOperation,
): Promise<{ executed: boolean; error?: string }> {
  const supabase = createAdminClient();

  await markStatus(op.id, 'processing');

  try {
    // Get fresh quote at current market
    const freshQuote = await fetchQuote(op);

    const originalRate = extractRate(op.type, op.initial_quote);
    const currentRate = extractRate(op.type, freshQuote);
    const deviationBps = calculateDeviationBps(originalRate, currentRate);

    // Update execution quote
    await supabase
      .from('scheduled_operations')
      .update({
        execution_quote: freshQuote,
        deviation_bps: deviationBps,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    // Re-gate: tolerance-override from the user does NOT override
    // policy. A flagged op that now breaches balance/forecast/sanctions
    // rules still gets denied here.
    const regateOutcome = await reGateAtExecution(op);
    if (!regateOutcome.ok) {
      const realEnterpriseId = await getRealEnterpriseId(op.user_id);
      await handleReGateDenial(op, regateOutcome, realEnterpriseId);
      return { executed: false, error: regateOutcome.human_readable };
    }

    // Execute regardless of deviation
    const meta = scheduledMeta(originalRate, currentRate, deviationBps, op.scheduled_for);
    const result = await executeByType(op, freshQuote, meta);

    await markStatus(op.id, 'completed', {
      executed_at: new Date().toISOString(),
      tx_hash: (result as any).txHash ?? null,
    });

    await writeAuditLog({
      userId: op.user_id,
      action: 'scheduled_operation_approve' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: {
        type: op.type,
        deviation_bps: deviationBps,
        record_id: result.recordId,
        approved_at_rate: currentRate,
      },
    });

    return { executed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markStatus(op.id, 'failed', { error_message: message });
    return { executed: false, error: message };
  }
}
