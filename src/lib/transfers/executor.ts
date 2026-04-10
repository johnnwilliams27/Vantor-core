import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { requireClearScreening } from '@/lib/compliance/screening';
import { getComplianceAdapter } from '@/lib/compliance/factory';
import { updateBalancesAfterTransfer } from '@/lib/balances/update-after-movement';
import { recordUsageFee } from '@/lib/billing/usage';
import type { Transfer } from '@/types/database';

/**
 * Core transfer execution logic (server-side only).
 * NOTE: In production this would use hot-wallet private keys from a KMS.
 * For this implementation we record the transfer and emit the audit log;
 * actual on-chain tx submission requires a funded server-side wallet.
 */
export async function executeTransfer(transfer: Transfer): Promise<{
  txHash?: string;
  error?: string;
}> {
  const supabase = createAdminClient();

  try {
    // --- Sanctions screening (pre-execution gate) ---
    await requireClearScreening(
      transfer.user_id,
      transfer.to_address,
      transfer.chain,
      'transfer',
      transfer.id
    );

    // Mark as processing first (idempotency)
    await supabase
      .from('transfers')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', transfer.id);

    // --- SIMULATE tx execution (replace with real blockchain call) ---
    // In production:
    //   if chain === 'solana': await transferSolanaToken(...)
    //   if chain === 'ethereum': await transferEthereumToken(...)
    const fakeTxHash =
      transfer.chain === 'ethereum'
        ? `0x${Buffer.from(transfer.id).toString('hex').slice(0, 64)}`
        : Buffer.from(transfer.id).toString('hex').slice(0, 88);

    // Record completed
    await supabase
      .from('transfers')
      .update({
        status: 'completed',
        tx_hash: fakeTxHash,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', transfer.id);

    // Record transfer attempt
    await supabase.from('transfer_attempts').insert({
      transfer_id: transfer.id,
      attempt_no: 1,
      status: 'completed',
      tx_hash: fakeTxHash,
    });

    // Update invoice if linked
    if (transfer.invoice_id) {
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transfer.invoice_id);
    }

    // Update sender wallet balance (mock fallback — real balances sync from chain)
    if (transfer.from_wallet_id) {
      await updateBalancesAfterTransfer({
        walletId: transfer.from_wallet_id,
        token: transfer.token,
        amount: Number(transfer.amount),
      });
    }

    await writeAuditLog({
      userId: transfer.user_id,
      action: 'transfer_execute',
      entityType: 'transfer',
      entityId: transfer.id,
      details: { txHash: fakeTxHash, chain: transfer.chain, amount: transfer.amount },
    });

    // --- Record Vantor fee (0.25% of notional, billed monthly via Stripe) ---
    // On-chain transfers can't use Bridge's developer fee — there's no rail to deduct from.
    // These get added to the customer's monthly Stripe invoice as line items.
    if (transfer.enterprise_id) {
      await recordUsageFee({
        enterpriseId: transfer.enterprise_id,
        transactionType: 'transfer',
        transactionId: transfer.id,
        notionalAmountUsd: Number(transfer.amount), // stablecoin amount ≈ USD
        collectedVia: 'stripe_invoice',
      });
    }

    // --- KYT: register transfer for monitoring (non-blocking) ---
    getComplianceAdapter()
      .registerTransfer({
        externalId: transfer.id,
        chain: transfer.chain,
        direction: 'sent',
        txHash: fakeTxHash,
        fromAddress: transfer.from_address ?? '',
        toAddress: transfer.to_address,
        asset: transfer.token,
        amount: Number(transfer.amount),
        amountUsd: Number(transfer.amount),
        timestamp: new Date().toISOString(),
      })
      .then(async (kytResult) => {
        // Persist KYT transfer record
        await supabase.from('kyt_transfers').insert({
          user_id: transfer.user_id,
          external_id: transfer.id,
          chain: transfer.chain,
          direction: 'sent',
          tx_hash: fakeTxHash,
          from_address: transfer.from_address ?? '',
          to_address: transfer.to_address,
          token: transfer.token,
          amount: transfer.amount,
          asset_amount_usd: transfer.amount,
          risk_score: kytResult.riskScore,
          cluster_name: kytResult.clusterName,
          cluster_category: kytResult.clusterCategory,
          raw_response: kytResult.rawResponse,
          transfer_id: transfer.id,
        });

        // Persist any alerts
        for (const alert of kytResult.alerts) {
          await supabase.from('kyt_alerts').insert({
            user_id: transfer.user_id,
            kyt_transfer_id: null,
            external_alert_id: alert.alertId,
            severity: alert.severity,
            status: 'open',
            category: alert.category,
            description: alert.description,
          });
        }

        if (kytResult.alerts.length > 0) {
          await writeAuditLog({
            userId: transfer.user_id,
            action: 'compliance_kyt_register',
            entityType: 'transfer',
            entityId: transfer.id,
            details: {
              riskScore: kytResult.riskScore,
              alertCount: kytResult.alerts.length,
            },
          });
        }
      })
      .catch((err) => console.error('[KYT] Registration failed:', err));

    return { txHash: fakeTxHash };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from('transfers')
      .update({
        status: 'failed',
        error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transfer.id);

    await supabase.from('transfer_attempts').insert({
      transfer_id: transfer.id,
      attempt_no: 1,
      status: 'failed',
      error: errorMsg,
    });

    await writeAuditLog({
      userId: transfer.user_id,
      action: 'transfer_execute',
      entityType: 'transfer',
      entityId: transfer.id,
      details: { error: errorMsg },
    });

    return { error: errorMsg };
  }
}
