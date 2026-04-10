import { createAdminClient } from '@/lib/supabase/admin';
import { VANTOR_FEE_RATE } from './tiers';

export function calculateVantorFee(notionalAmountUsd: number): number {
  return notionalAmountUsd * VANTOR_FEE_RATE;
}

export type UsageFeeTransactionType = 'ramp' | 'swap' | 'bridge' | 'transfer' | 'fiat_payment';
export type CollectedVia = 'bridge' | 'stripe_invoice';

/**
 * Records a Vantor fee for visibility/reconciliation.
 *
 * Collection paths (hybrid model):
 * - 'bridge'         → Bridge auto-deducts at the rail; we just track it for the dashboard.
 *                      The Stripe webhook does NOT bill these (no double-charge).
 * - 'stripe_invoice' → On-chain transfers and other off-rail flows. The Stripe webhook
 *                      adds these as line items on the monthly invoice.
 */
export async function recordUsageFee(params: {
  enterpriseId: string;
  transactionType: UsageFeeTransactionType;
  transactionId: string;
  notionalAmountUsd: number;
  collectedVia: CollectedVia;
}): Promise<void> {
  const supabase = createAdminClient();
  const feeAmount = calculateVantorFee(params.notionalAmountUsd);
  const now = new Date();
  const billingPeriod = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  await supabase.from('usage_fees').insert({
    enterprise_id: params.enterpriseId,
    transaction_type: params.transactionType,
    transaction_id: params.transactionId,
    notional_amount: params.notionalAmountUsd,
    fee_rate: VANTOR_FEE_RATE,
    fee_amount: feeAmount,
    billing_period: billingPeriod,
    collected_via: params.collectedVia,
  });
}
