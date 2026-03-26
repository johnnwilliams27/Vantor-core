import { createAdminClient } from '@/lib/supabase/admin';
import { VANTOR_FEE_RATE } from './tiers';

export function calculateVantorFee(notionalAmountUsd: number): number {
  return notionalAmountUsd * VANTOR_FEE_RATE;
}

export async function recordUsageFee(params: {
  enterpriseId: string;
  transactionType: 'ramp' | 'swap' | 'bridge';
  transactionId: string;
  notionalAmountUsd: number;
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
  });
}
