import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ invoices: [] });
  }

  const invoices = await stripe.invoices.list({
    customer: sub.stripe_customer_id,
    limit: 24,
  });

  return NextResponse.json({
    invoices: invoices.data.map((inv) => ({
      id: inv.id,
      period_start: inv.period_start,
      period_end: inv.period_end,
      amount_due: inv.amount_due,
      amount_paid: inv.amount_paid,
      status: inv.status,
      created: inv.created,
      invoice_pdf: inv.invoice_pdf,
    })),
  });
}
