import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { NotificationService } from '@/lib/notifications/service';
import { actionNotificationEmail } from '@/lib/notifications/email-templates';
import { getComplianceAdapter } from '@/lib/compliance/factory';
import { recordUsageFee } from '@/lib/billing/usage';
import { updateBalancesAfterTransfer } from '@/lib/balances/update-after-movement';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import { fireInlineInsights } from '@/lib/insights/inline';

const schema = z.object({
  transferId: z.string().uuid(),
  txHash: z.string().min(4).max(200),
  blockNumber: z.string().optional(),
});

/**
 * Records a completed on-chain transfer after the client has signed and
 * submitted the transaction via the user's connected wallet.
 *
 * Mirrors /api/yield/confirm-deposit — the client drives execution, this
 * endpoint just persists the result and kicks off downstream side-effects.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('confirm transfers'); throw e; }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  // Load the pending transfer and verify ownership
  const { data: transfer, error: loadErr } = await supabase
    .from('transfers')
    .select('*')
    .eq('id', parsed.data.transferId)
    .eq('user_id', session.user.id)
    .single();

  if (loadErr || !transfer) {
    return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
  }

  if (transfer.status === 'completed') {
    // Idempotent: already recorded, return the existing row
    return NextResponse.json({ data: transfer });
  }

  // ─── Lazy materialization of approval outcome onto transfer row ──
  // When the transfer went through the policy gate and required approval,
  // the workflow service wrote only to policy_approval_requests — not to
  // transfers. Reflect the outcome here before gating on status.
  if (transfer.status === 'awaiting_approval') {
    const { data: approval } = await supabase
      .from('policy_approval_requests')
      .select('status, denial_reason')
      .eq('movement_id', transfer.id)
      .eq('enterprise_id', enterpriseId)
      .maybeSingle();

    if (approval?.status === 'executed') {
      await supabase
        .from('transfers')
        .update({ status: 'pending' })
        .eq('id', transfer.id);
      transfer.status = 'pending';
    } else if (approval?.status === 'denied' || approval?.status === 'cancelled') {
      const nextDenialReason = approval.denial_reason ?? approval.status;
      await supabase
        .from('transfers')
        .update({ status: 'denied', denial_reason: nextDenialReason })
        .eq('id', transfer.id);
      transfer.status = 'denied';
      (transfer as Record<string, unknown>).denial_reason = nextDenialReason;
    }
    // else: approval still pending — transfer stays awaiting_approval below.
  }

  if (transfer.status !== 'pending' && transfer.status !== 'processing') {
    return NextResponse.json(
      {
        error: `Cannot confirm transfer in state: ${transfer.status}`,
        status: transfer.status,
        ...((transfer as Record<string, unknown>).denial_reason
          ? { denial_reason: (transfer as Record<string, unknown>).denial_reason }
          : {}),
      },
      { status: 409 },
    );
  }

  // Mark as completed
  const { data: updated, error: updErr } = await supabase
    .from('transfers')
    .update({
      status: 'completed',
      tx_hash: parsed.data.txHash,
      executed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transfer.id)
    .select()
    .single();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Record the attempt (audit trail for on-chain submissions)
  await supabase.from('transfer_attempts').insert({
    transfer_id: transfer.id,
    attempt_no: 1,
    status: 'completed',
    tx_hash: parsed.data.txHash,
  });

  // Mark linked invoice paid
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

  // Update sender balance (mock fallback — real balances sync from chain)
  if (transfer.from_wallet_id) {
    await updateBalancesAfterTransfer({
      walletId: transfer.from_wallet_id,
      token: transfer.token,
      amount: Number(transfer.amount),
    });
  }

  // Record Vantor fee (on-chain transfers billed via monthly Stripe invoice)
  if (transfer.enterprise_id) {
    await recordUsageFee({
      enterpriseId: transfer.enterprise_id,
      transactionType: 'transfer',
      transactionId: transfer.id,
      notionalAmountUsd: Number(transfer.amount),
      collectedVia: 'stripe_invoice',
    });
  }

  // Audit log
  await writeAuditLog({
    userId: session.user.id,
    enterpriseId: transfer.enterprise_id,
    action: 'transfer_execute',
    entityType: 'transfer',
    entityId: transfer.id,
    details: {
      txHash: parsed.data.txHash,
      chain: transfer.chain,
      token: transfer.token,
      amount: transfer.amount,
      onChain: true,
    },
  });

  // Fire insight detectors inline (non-blocking). Skip for non-enterprise
  // users — detectors require enterprise scope to be meaningful.
  if (enterpriseId) {
    fireInlineInsights(supabase, {
      enterpriseId,
      userId: session.user.id,
      trigger: 'transfer_confirm',
    }).catch(() => {});
  }

  // Notify (non-blocking)
  if (enterpriseId) {
    const emailHtml = actionNotificationEmail({
      title: 'Transfer Completed',
      details: [
        { label: 'Amount', value: `${transfer.amount} ${transfer.token}` },
        { label: 'To', value: transfer.to_address },
        { label: 'Chain', value: transfer.chain },
        { label: 'Tx', value: parsed.data.txHash },
      ],
      ctaLabel: 'View Transaction',
      ctaHref: '/transactions',
    });

    NotificationService.notify({
      eventType: 'transfer_completed',
      enterpriseId: session.user.enterprise_id!,
      title: 'Transfer Completed',
      body: `Sent ${transfer.amount} ${transfer.token} on ${transfer.chain}`,
      link: '/transactions',
      metadata: {
        transferId: transfer.id,
        _emailSubject: 'Transfer Completed',
        _emailHtml: emailHtml,
      },
      actorId: session.user.id,
    }).catch(() => {});
  }

  // KYT registration (non-blocking)
  getComplianceAdapter()
    .registerTransfer({
      externalId: transfer.id,
      chain: transfer.chain,
      direction: 'sent',
      txHash: parsed.data.txHash,
      fromAddress: transfer.from_address ?? '',
      toAddress: transfer.to_address,
      asset: transfer.token,
      amount: Number(transfer.amount),
      amountUsd: Number(transfer.amount),
      timestamp: new Date().toISOString(),
    })
    .then(async (kytResult) => {
      await supabase.from('kyt_transfers').insert({
        user_id: transfer.user_id,
        external_id: transfer.id,
        chain: transfer.chain,
        direction: 'sent',
        tx_hash: parsed.data.txHash,
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
    })
    .catch((err) => console.error('[KYT] Registration failed:', err));

  return NextResponse.json({ data: updated });
}
