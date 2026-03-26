import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_app_admin) {
    return NextResponse.json({ error: 'App admin required' }, { status: 403 });
  }

  const { customPriceUsd } = await req.json();
  if (!customPriceUsd || typeof customPriceUsd !== 'number' || customPriceUsd <= 0) {
    return NextResponse.json({ error: 'Valid custom price required' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', params.id)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  }

  // Create custom Stripe price
  const price = await stripe.prices.create({
    unit_amount: Math.round(customPriceUsd * 100),
    currency: 'usd',
    recurring: { interval: 'month' },
    product: process.env.STRIPE_PRODUCT_ENTERPRISE!,
    metadata: { enterprise_id: params.id },
  });

  if (sub.stripe_subscription_id) {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: stripeSub.items.data[0].id, price: price.id }],
    });
  } else if (sub.stripe_customer_id) {
    const stripeSub = await stripe.subscriptions.create({
      customer: sub.stripe_customer_id,
      items: [{ price: price.id }],
    });

    await supabaseAdmin
      .from('subscriptions')
      .update({
        stripe_subscription_id: stripeSub.id,
        tier: 'enterprise',
        status: 'active',
        custom_price: customPriceUsd,
        updated_at: new Date().toISOString(),
      })
      .eq('enterprise_id', params.id);
  }

  await supabaseAdmin
    .from('enterprises')
    .update({ subscription_tier: 'enterprise' })
    .eq('id', params.id);

  await supabaseAdmin
    .from('subscriptions')
    .update({ custom_price: customPriceUsd, tier: 'enterprise', updated_at: new Date().toISOString() })
    .eq('enterprise_id', params.id);

  return NextResponse.json({ success: true });
}
