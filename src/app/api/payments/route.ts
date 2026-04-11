import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { NotificationService } from '@/lib/notifications/service';
import { actionNotificationEmail, fmtUsd } from '@/lib/notifications/email-templates';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { recordUsageFee } from '@/lib/billing/usage';
import { z } from 'zod';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;

const schema = z.object({
  fromBankAccountId: z.string().uuid(),
  toBankName: z.string().min(1),
  toAccountNumber: z.string().min(4),
  toRoutingNumber: z.string().min(4),
  toAccountHolder: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal amount'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'BRL', 'MXN']),
  paymentRail: z.enum(['ach_push', 'ach_same_day', 'wire', 'swift', 'sepa', 'spei', 'pix']),
  scheduledFor: z.string().datetime().optional(),
  invoiceId: z.string().uuid().optional(),
  memo: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { searchParams } = new URL(req.url);
  const rawStatus = searchParams.get('status');
  const status = rawStatus && (PAYMENT_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : null;

  const supabase = createAdminClient();

  let q = supabase
    .from('fiat_payments')
    .select('*, from_bank_account:bank_accounts(id, institution_name, account_name, last4, nickname)')
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false });

  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('send payments'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify bank account belongs to user/enterprise
  const { data: bankAccount } = await supabase
    .from('bank_accounts')
    .select('id')
    .eq('id', parsed.data.fromBankAccountId)
    .eq('user_id', session.user.id)
    .single();

  if (!bankAccount) return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });

  // Scheduled fiat payments are not yet supported — they require unattended
  // rail selection which isn't possible without a cron-time user decision.
  // The UI shows a Coming Soon placeholder for the schedule tab.
  if (parsed.data.scheduledFor) {
    return NextResponse.json(
      { error: 'Scheduled payments are not yet supported. Send the payment immediately or check back soon.' },
      { status: 400 },
    );
  }

  const isScheduled = false;
  let paymentData: Record<string, unknown>;

  if (isScheduled) {
    // Unreachable — kept for future restoration when unattended scheduling lands.
    paymentData = {};
  } else {
    // Immediate: call adapter
    const mode = getIntegrationMode(session.user.subscription_tier);
    const adapter = getBankingAdapter(mode);
    const result = await adapter.createFiatPayment({
      fromBankAccountRef: parsed.data.fromBankAccountId,
      toBankName: parsed.data.toBankName,
      toAccountNumber: parsed.data.toAccountNumber,
      toRoutingNumber: parsed.data.toRoutingNumber,
      toAccountHolder: parsed.data.toAccountHolder,
      amount: parseFloat(parsed.data.amount),
      currency: parsed.data.currency,
      memo: parsed.data.memo,
      paymentRail: parsed.data.paymentRail,
    });

    paymentData = {
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      from_bank_account_id: parsed.data.fromBankAccountId,
      to_bank_name: parsed.data.toBankName,
      to_account_number: parsed.data.toAccountNumber,
      to_routing_number: parsed.data.toRoutingNumber,
      to_account_holder: parsed.data.toAccountHolder,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      status: 'pending',
      scheduled_for: null,
      executed_at: new Date().toISOString(),
      provider_payment_id: result.providerPaymentId,
      estimated_settlement: result.estimatedSettlement,
      invoice_id: parsed.data.invoiceId ?? null,
      memo: parsed.data.memo ?? null,
    };
  }

  const { data: payment, error: insertErr } = await supabase
    .from('fiat_payments')
    .insert(paymentData)
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // --- Record Vantor fee on immediate payments (scheduled payments record at execution time) ---
  // Bridge auto-deducts via developer_fee_percent; we track for visibility only.
  if (!isScheduled && enterpriseId) {
    await recordUsageFee({
      enterpriseId,
      transactionType: 'fiat_payment',
      transactionId: payment.id,
      notionalAmountUsd: parseFloat(parsed.data.amount),
      collectedVia: 'bridge',
    });
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'fiat_payment_create',
    entityType: 'fiat_payment',
    entityId: payment.id,
    details: {
      amount: payment.amount,
      currency: payment.currency,
      toBankName: payment.to_bank_name,
      scheduled: isScheduled,
      scheduledFor: payment.scheduled_for,
    },
  });

  if (!isScheduled && enterpriseId) {
    const emailHtml = actionNotificationEmail({
      title: 'Payment Sent',
      details: [
        { label: 'Amount', value: fmtUsd(payment.amount) },
        { label: 'Currency', value: payment.currency },
        { label: 'Recipient', value: payment.to_account_holder },
        { label: 'Bank', value: payment.to_bank_name },
      ],
      ctaLabel: 'View Payment',
      ctaHref: '/payments',
    });

    await NotificationService.notify({
      eventType: 'payment_sent',
      enterpriseId: session.user.enterprise_id!,
      title: 'Payment Sent',
      body: `Sent ${fmtUsd(payment.amount)} ${payment.currency} to ${payment.to_account_holder}`,
      link: '/payments',
      metadata: {
        paymentId: payment.id,
        _emailSubject: 'Payment Sent',
        _emailHtml: emailHtml,
      },
      actorId: session.user.id,
    }).catch(() => {});
  }

  return NextResponse.json({ data: payment }, { status: 201 });
}
