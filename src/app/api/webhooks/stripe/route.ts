import { NextRequest, NextResponse } from 'next/server';
import { stripe, STRIPE_WEBHOOK_SECRET } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateInvoicePdf } from '@/lib/billing/invoice-pdf';
import { sendEmail } from '@/lib/email/send';
import { monthlyBillEmailHtml } from '@/lib/email/templates/monthly-bill';
import { TIERS, TierSlug } from '@/lib/billing/tiers';
import type Stripe from 'stripe';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  // Idempotency check
  const { data: existing } = await supabaseAdmin
    .from('webhook_events')
    .select('id')
    .eq('event_id', event.id)
    .single();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record event
  await supabaseAdmin.from('webhook_events').insert({
    source: 'stripe',
    event_id: event.id,
    event_type: event.type,
  });

  try {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.created':
        await handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;
      case 'payment_method.detached':
        await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, enterprise_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!sub) return;

  const item = subscription.items.data[0];
  const product = await stripe.products.retrieve(item.price.product as string);
  const tier = product.metadata.tier as string || 'lite';

  // Update BOTH tables atomically via Postgres RPC function
  await supabaseAdmin.rpc('update_subscription_tier', {
    p_sub_id: sub.id,
    p_enterprise_id: sub.enterprise_id,
    p_tier: tier,
    p_status: subscription.status,
    p_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    p_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, enterprise_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!sub) return;

  await supabaseAdmin.rpc('update_subscription_tier', {
    p_sub_id: sub.id,
    p_enterprise_id: sub.enterprise_id,
    p_tier: 'lite',
    p_status: 'canceled',
    p_period_start: null,
    p_period_end: null,
  });
}

async function handleInvoiceCreated(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return;
  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('enterprise_id')
    .eq('stripe_subscription_id', invoice.subscription)
    .single();

  if (!sub) return;

  // Pause auto-advance to add usage fee line items
  await stripe.invoices.update(invoice.id, { auto_advance: false });

  const periodStart = new Date(invoice.period_start * 1000);
  const billingPeriod = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: fees } = await supabaseAdmin
    .from('usage_fees')
    .select('transaction_type, fee_amount')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('billing_period', billingPeriod);

  if (fees && fees.length > 0) {
    const byType: Record<string, { count: number; total: number }> = {};
    for (const fee of fees) {
      if (!byType[fee.transaction_type]) {
        byType[fee.transaction_type] = { count: 0, total: 0 };
      }
      byType[fee.transaction_type].count++;
      byType[fee.transaction_type].total += Number(fee.fee_amount);
    }

    for (const [type, { count, total }] of Object.entries(byType)) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      await stripe.invoiceItems.create({
        customer: invoice.customer as string,
        invoice: invoice.id,
        amount: Math.round(total * 100),
        currency: 'usd',
        description: `Vantor ${label} fees (${count} transactions)`,
      });
    }
  }

  await stripe.invoices.finalizeInvoice(invoice.id);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return;

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('enterprise_id, tier, custom_price')
    .eq('stripe_subscription_id', invoice.subscription)
    .single();

  if (!sub) return;

  const { data: enterprise } = await supabaseAdmin
    .from('enterprises')
    .select('name')
    .eq('id', sub.enterprise_id)
    .single();

  // Get treasury_manager email
  const { data: manager } = await supabaseAdmin
    .from('user_profiles')
    .select('email')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('role', 'treasury_manager')
    .limit(1)
    .single();

  if (!manager?.email) return;

  // Aggregate usage fees
  const periodStart = new Date(invoice.period_start * 1000);
  const billingPeriod = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: fees } = await supabaseAdmin
    .from('usage_fees')
    .select('transaction_type, fee_amount')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('billing_period', billingPeriod);

  const byType: Record<string, { count: number; total: number }> = {
    ramp: { count: 0, total: 0 },
    swap: { count: 0, total: 0 },
    bridge: { count: 0, total: 0 },
  };
  for (const fee of fees || []) {
    if (byType[fee.transaction_type]) {
      byType[fee.transaction_type].count++;
      byType[fee.transaction_type].total += Number(fee.fee_amount);
    }
  }

  // ERP add-ons
  const { count: erpAddons } = await supabaseAdmin
    .from('erp_addons')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', sub.enterprise_id)
    .eq('active', true);

  // Get payment method
  const { data: pm } = await supabaseAdmin
    .from('payment_methods')
    .select('card_last4')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('is_default', true)
    .single();

  const tierDef = TIERS[sub.tier as TierSlug];
  const subscriptionCost = tierDef.price ? tierDef.price / 100 : (sub.custom_price || 0);

  const periodLabel = periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Generate PDF
  const pdfBuffer = await generateInvoicePdf({
    enterpriseName: enterprise?.name || 'Unknown',
    billingPeriod: periodLabel,
    tierName: tierDef.name,
    subscriptionCost,
    erpAddons: erpAddons || 0,
    erpAddonCost: (erpAddons || 0) * 1500,
    rampCount: byType.ramp.count,
    rampFees: byType.ramp.total,
    swapCount: byType.swap.count,
    swapFees: byType.swap.total,
    bridgeCount: byType.bridge.count,
    bridgeFees: byType.bridge.total,
    cardLast4: pm?.card_last4,
  });

  const totalAmount = subscriptionCost + (erpAddons || 0) * 1500 +
    byType.ramp.total + byType.swap.total + byType.bridge.total;

  // Send email with PDF
  await sendEmail({
    to: manager.email,
    subject: `Vantor Invoice — ${periodLabel}`,
    html: monthlyBillEmailHtml({
      enterpriseName: enterprise?.name || '',
      billingPeriod: periodLabel,
      totalAmount: `$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    }),
    attachments: [{
      filename: `vantor-invoice-${billingPeriod}.pdf`,
      content: pdfBuffer,
    }],
  });
}

async function handlePaymentMethodAttached(pm: Stripe.PaymentMethod) {
  if (!pm.customer || pm.type !== 'card' || !pm.card) return;
  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('enterprise_id')
    .eq('stripe_customer_id', pm.customer)
    .single();

  if (!sub) return;

  // Set all existing cards to non-default FIRST (avoids race condition)
  await supabaseAdmin
    .from('payment_methods')
    .update({ is_default: false })
    .eq('enterprise_id', sub.enterprise_id);

  await supabaseAdmin.from('payment_methods').insert({
    enterprise_id: sub.enterprise_id,
    stripe_payment_method_id: pm.id,
    card_brand: pm.card.brand,
    card_last4: pm.card.last4,
    card_exp_month: pm.card.exp_month,
    card_exp_year: pm.card.exp_year,
    is_default: true,
  });
}

async function handlePaymentMethodDetached(pm: Stripe.PaymentMethod) {
  const supabaseAdmin = createAdminClient();
  await supabaseAdmin
    .from('payment_methods')
    .delete()
    .eq('stripe_payment_method_id', pm.id);
}
