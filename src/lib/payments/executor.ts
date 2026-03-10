import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
import { requireClearScreening } from '@/lib/compliance/screening';
import { getComplianceAdapter } from '@/lib/compliance/factory';
import type { Payment } from '@/types/database';

/**
 * Core payment execution logic (server-side only).
 * NOTE: In production this would use hot-wallet private keys from a KMS.
 * For this implementation we record the payment and emit the audit log;
 * actual on-chain tx submission requires a funded server-side wallet.
 */
export async function executePayment(payment: Payment): Promise<{
  txHash?: string;
  error?: string;
}> {
  const supabase = createAdminClient();

  try {
    // --- Sanctions screening (pre-execution gate) ---
    await requireClearScreening(
      payment.user_id,
      payment.to_address,
      payment.chain,
      'payment',
      payment.id
    );

    // Mark as processing first (idempotency)
    await supabase
      .from('payments')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', payment.id);

    // --- SIMULATE tx execution (replace with real blockchain call) ---
    // In production:
    //   if chain === 'solana': await transferSolanaToken(...)
    //   if chain === 'ethereum': await transferEthereumToken(...)
    const fakeTxHash =
      payment.chain === 'ethereum'
        ? `0x${Buffer.from(payment.id).toString('hex').slice(0, 64)}`
        : Buffer.from(payment.id).toString('hex').slice(0, 88);

    // Record completed
    await supabase
      .from('payments')
      .update({
        status: 'completed',
        tx_hash: fakeTxHash,
        executed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    // Record payment attempt
    await supabase.from('payment_attempts').insert({
      payment_id: payment.id,
      attempt_no: 1,
      status: 'completed',
      tx_hash: fakeTxHash,
    });

    // Update invoice if linked
    if (payment.invoice_id) {
      await supabase
        .from('invoices')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', payment.invoice_id);
    }

    await writeAuditLog({
      userId: payment.user_id,
      action: 'payment_execute',
      entityType: 'payment',
      entityId: payment.id,
      details: { txHash: fakeTxHash, chain: payment.chain, amount: payment.amount },
    });

    // --- KYT: register transfer for monitoring (non-blocking) ---
    getComplianceAdapter()
      .registerTransfer({
        externalId: payment.id,
        chain: payment.chain,
        direction: 'sent',
        txHash: fakeTxHash,
        fromAddress: payment.from_address ?? '',
        toAddress: payment.to_address,
        asset: payment.token,
        amount: Number(payment.amount),
        amountUsd: Number(payment.amount),
        timestamp: new Date().toISOString(),
      })
      .then(async (kytResult) => {
        // Persist KYT transfer record
        await supabase.from('kyt_transfers').insert({
          user_id: payment.user_id,
          external_id: payment.id,
          chain: payment.chain,
          direction: 'sent',
          tx_hash: fakeTxHash,
          from_address: payment.from_address ?? '',
          to_address: payment.to_address,
          token: payment.token,
          amount: payment.amount,
          asset_amount_usd: payment.amount,
          risk_score: kytResult.riskScore,
          cluster_name: kytResult.clusterName,
          cluster_category: kytResult.clusterCategory,
          raw_response: kytResult.rawResponse,
          payment_id: payment.id,
        });

        // Persist any alerts
        for (const alert of kytResult.alerts) {
          await supabase.from('kyt_alerts').insert({
            user_id: payment.user_id,
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
            userId: payment.user_id,
            action: 'compliance_kyt_register',
            entityType: 'payment',
            entityId: payment.id,
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
      .from('payments')
      .update({
        status: 'failed',
        error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', payment.id);

    await supabase.from('payment_attempts').insert({
      payment_id: payment.id,
      attempt_no: 1,
      status: 'failed',
      error: errorMsg,
    });

    await writeAuditLog({
      userId: payment.user_id,
      action: 'payment_execute',
      entityType: 'payment',
      entityId: payment.id,
      details: { error: errorMsg },
    });

    return { error: errorMsg };
  }
}
