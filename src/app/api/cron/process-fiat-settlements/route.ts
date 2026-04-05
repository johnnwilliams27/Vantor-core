import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBankingAdapter } from '@/lib/banking/factory';
import { writeAuditLog } from '@/lib/audit/logger';

const BATCH_SIZE = 50;

// Cross-enterprise system job: processes scheduled fiat payments and settles completed ones.
// No session available — authenticated via CRON_SECRET.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  // Cron job — no session; authenticated via CRON_SECRET; always use live mode
  const adapter = getBankingAdapter('live');

  // Get test enterprise IDs to exclude from cron processing
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e: { id: string }) => e.id);

  let executeSucceeded = 0;
  let executeFailed = 0;
  let settleSucceeded = 0;
  let settleFailed = 0;

  // ---- Phase 1: Execute scheduled payments that are now due ----
  {
    let query = supabase
      .from('fiat_payments')
      .select('*')
      .eq('status', 'pending')
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', new Date().toISOString())
      .is('executed_at', null)
      .limit(BATCH_SIZE);

    if (testEntIds.length > 0) {
      query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
    }

    const { data: payments, error } = await query;

    if (error) {
      console.error('[cron/fiat-settlements] Phase 1 query error:', error);
    } else if (payments?.length) {
      for (const payment of payments) {
        try {
          const result = await adapter.createFiatPayment({
            fromBankAccountRef: payment.from_bank_account_id,
            toBankName: payment.to_bank_name,
            toAccountNumber: payment.to_account_number,
            toRoutingNumber: payment.to_routing_number,
            toAccountHolder: payment.to_account_holder,
            amount: parseFloat(payment.amount),
            currency: payment.currency,
            memo: payment.memo ?? undefined,
          });

          await supabase
            .from('fiat_payments')
            .update({
              executed_at: new Date().toISOString(),
              provider_payment_id: result.providerPaymentId,
              estimated_settlement: result.estimatedSettlement,
            })
            .eq('id', payment.id);

          await writeAuditLog({
            userId: payment.user_id,
            action: 'fiat_payment_execute',
            entityType: 'fiat_payment',
            entityId: payment.id,
            details: { providerPaymentId: result.providerPaymentId },
          });

          executeSucceeded++;
        } catch (err) {
          console.error(`[cron/fiat-settlements] Failed to execute payment ${payment.id}:`, err);
          await supabase
            .from('fiat_payments')
            .update({
              status: 'failed',
              error_message: (err as Error).message,
            })
            .eq('id', payment.id);
          executeFailed++;
        }
      }
    }
  }

  // ---- Phase 2: Settle pending payments whose estimated_settlement has passed ----
  {
    let query = supabase
      .from('fiat_payments')
      .select('*')
      .eq('status', 'pending')
      .lte('estimated_settlement', new Date().toISOString())
      .not('executed_at', 'is', null)
      .limit(BATCH_SIZE);

    if (testEntIds.length > 0) {
      query = query.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
    }

    const { data: payments, error } = await query;

    if (error) {
      console.error('[cron/fiat-settlements] Phase 2 query error:', error);
    } else if (payments?.length) {
      for (const payment of payments) {
        try {
          if (!payment.provider_payment_id) continue;

          const statusResult = await adapter.getFiatPaymentStatus(payment.provider_payment_id);

          if (statusResult.status === 'completed') {
            await supabase
              .from('fiat_payments')
              .update({
                status: 'completed',
                settled_at: statusResult.settledAt ?? new Date().toISOString(),
              })
              .eq('id', payment.id);

            // Mark linked invoice as paid if present
            if (payment.invoice_id) {
              await supabase
                .from('invoices')
                .update({ status: 'paid', paid_at: new Date().toISOString() })
                .eq('id', payment.invoice_id);
            }

            await writeAuditLog({
              userId: payment.user_id,
              action: 'fiat_payment_settle',
              entityType: 'fiat_payment',
              entityId: payment.id,
              details: {
                settledAt: statusResult.settledAt,
                invoiceId: payment.invoice_id ?? null,
              },
            });

            settleSucceeded++;
          } else if (statusResult.status === 'failed') {
            await supabase
              .from('fiat_payments')
              .update({ status: 'failed' })
              .eq('id', payment.id);
            settleFailed++;
          }
        } catch (err) {
          console.error(`[cron/fiat-settlements] Failed to settle payment ${payment.id}:`, err);
          settleFailed++;
        }
      }
    }
  }

  console.log(
    `[cron/fiat-settlements] execute ok=${executeSucceeded} fail=${executeFailed} | settle ok=${settleSucceeded} fail=${settleFailed}`
  );

  return NextResponse.json({
    executeSucceeded,
    executeFailed,
    settleSucceeded,
    settleFailed,
  });
}
