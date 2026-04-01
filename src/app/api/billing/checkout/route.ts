import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { TierSlug, isPaidTier } from '@/lib/billing/tiers';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetTier } = await req.json();

  if (!isPaidTier(targetTier as TierSlug) || targetTier === 'enterprise') {
    return NextResponse.json({ error: 'Invalid tier for checkout' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  // Verify KYB + KYC (skip KYB if not configured)
  if (process.env.PERSONA_KYB_TEMPLATE_ID) {
    const { data: kyb } = await supabaseAdmin
      .from('kyb_verifications')
      .select('status')
      .eq('enterprise_id', session.user.enterprise_id)
      .single();

    if (kyb?.status !== 'completed') {
      return NextResponse.json({ error: 'KYB required' }, { status: 400 });
    }
  }

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('status, persona_inquiry_id')
    .eq('user_id', session.user.id)
    .single();

  // Allow checkout if KYC is completed OR if an inquiry was started
  // (webhook may not have fired yet — Persona confirms async)
  if (!kyc?.persona_inquiry_id) {
    return NextResponse.json({ error: 'KYC required' }, { status: 400 });
  }

  // Get or create Stripe customer
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  let stripeCustomerId = sub?.stripe_customer_id;

  if (!stripeCustomerId) {
    const { data: enterprise } = await supabaseAdmin
      .from('enterprises')
      .select('name')
      .eq('id', session.user.enterprise_id)
      .single();

    const customer = await stripe.customers.create({
      email: session.user.email!,
      name: enterprise?.name,
      metadata: { enterprise_id: session.user.enterprise_id },
    });

    stripeCustomerId = customer.id;

    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('enterprise_id', session.user.enterprise_id);
  }

  // Look up the Stripe price for target tier
  const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
  }

  // Create Stripe Checkout session
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      billing_cycle_anchor: getNextFirstOfMonth(),
    },
    success_url: `${process.env.NEXTAUTH_URL}/settings/billing?upgrade=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/settings/billing?upgrade=cancelled`,
    metadata: {
      enterprise_id: session.user.enterprise_id,
      target_tier: targetTier,
    },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

function getNextFirstOfMonth(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.floor(next.getTime() / 1000);
}
