import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabaseAdmin = createAdminClient();

  const now = new Date();
  const billingPeriod = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: fees } = await supabaseAdmin
    .from('usage_fees')
    .select('transaction_type, fee_amount, collected_via')
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('billing_period', billingPeriod);

  // Aggregate by type
  const summary: Record<string, { count: number; total: number; collected_via: string }> = {
    ramp: { count: 0, total: 0, collected_via: 'bridge' },
    swap: { count: 0, total: 0, collected_via: 'bridge' },
    bridge: { count: 0, total: 0, collected_via: 'bridge' },
    transfer: { count: 0, total: 0, collected_via: 'stripe_invoice' },
    fiat_payment: { count: 0, total: 0, collected_via: 'bridge' },
  };

  let bridgeCollected = 0;
  let stripeInvoiced = 0;

  for (const fee of fees || []) {
    if (summary[fee.transaction_type]) {
      summary[fee.transaction_type].count++;
      summary[fee.transaction_type].total += Number(fee.fee_amount);
    }
    if (fee.collected_via === 'bridge') {
      bridgeCollected += Number(fee.fee_amount);
    } else {
      stripeInvoiced += Number(fee.fee_amount);
    }
  }

  const totalFees = bridgeCollected + stripeInvoiced;

  // Get ERP add-on count
  const { count: erpAddons } = await supabaseAdmin
    .from('erp_addons')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('active', true);

  return NextResponse.json({
    billingPeriod,
    transactionFees: summary,
    totalTransactionFees: totalFees,
    bridgeCollected,
    stripeInvoiced,
    erpAddons: erpAddons || 0,
    erpAddonCost: (erpAddons || 0) * 1500,
  });
}
