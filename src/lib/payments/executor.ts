import { createAdminClient } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/audit/logger';
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
