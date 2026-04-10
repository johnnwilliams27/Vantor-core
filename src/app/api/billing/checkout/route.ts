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

  // KYC check is gated on Persona being configured. If Persona isn't set up
  // in this environment we skip the check entirely (matches the KYB pattern
  // above). When Persona is wired up in prod, set PERSONA_API_KEY in Vercel
  // env vars to enforce this gate.
  if (process.env.PERSONA_API_KEY) {
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
  }

  // Get or create Stripe customer. Uses upsert so a missing subscriptions row
  // for edge-case users (registered before the auto-insert, or manually created)
  // doesn't silently drop the customer ID on the floor.
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .maybeSingle();

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

    // Upsert so this works whether or not a subscriptions row already exists.
    await supabaseAdmin
      .from('subscriptions')
      .upsert(
        {
          enterprise_id: session.user.enterprise_id,
          tier: sub?.tier ?? 'lite',
          status: sub?.status ?? 'active',
          stripe_customer_id: stripeCustomerId,
        },
        { onConflict: 'enterprise_id' },
      );
  }

  // Look up the Stripe price for target tier
  const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
  }

  // Create Stripe Checkout session
  //
  // payment_method_collection: 'always' is critical for the Starter tier —
  // Stripe's default ('if_required') would skip card collection on a $0
  // subscription, leaving no card on file to charge when monthly usage fees
  // (0.25% of transfer notional) land on the invoice.
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    payment_method_collection: 'always',
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
