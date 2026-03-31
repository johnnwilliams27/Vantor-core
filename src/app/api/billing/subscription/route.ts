import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/billing/stripe';
import { TIERS, TierSlug, isUpgrade, isDowngrade } from '@/lib/billing/tiers';
import { canDowngrade } from '@/lib/billing/gate';

// GET — current subscription
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  const tier = TIERS[sub.tier as TierSlug];

  return NextResponse.json({
    ...sub,
    tierDetails: tier,
  });
}

// POST — upgrade subscription
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetTier } = await req.json();
  const currentTier = session.user.subscription_tier as TierSlug;

  if (!TIERS[targetTier as TierSlug]) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }

  if (targetTier === 'enterprise') {
    return NextResponse.json({ error: 'Contact us for Enterprise pricing' }, { status: 400 });
  }

  if (!isUpgrade(currentTier, targetTier)) {
    return NextResponse.json({ error: 'Can only upgrade to a higher tier via POST' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  // Verify KYB + KYC completed
  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('status')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (kyb?.status !== 'completed') {
    return NextResponse.json({ error: 'KYB verification required before upgrading' }, { status: 400 });
  }

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('status')
    .eq('user_id', session.user.id)
    .single();

  if (kyc?.status !== 'completed') {
    return NextResponse.json({ error: 'KYC verification required before upgrading' }, { status: 400 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  if (sub.stripe_subscription_id) {
    // Existing Stripe subscription — upgrade in place
    const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const currentItem = stripeSubscription.items.data[0];

    // Find the price for the target tier
    const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: currentItem.id, price: priceId }],
      proration_behavior: 'create_prorations',
    });
  }
  // If no Stripe subscription yet (Lite -> paid), it's created via checkout route

  return NextResponse.json({ success: true });
}

// PATCH — downgrade subscription
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetTier } = await req.json();
  const currentTier = session.user.subscription_tier as TierSlug;

  if (!isDowngrade(currentTier, targetTier)) {
    return NextResponse.json({ error: 'Can only downgrade to a lower tier via PATCH' }, { status: 400 });
  }

  // Check if downgrade is allowed
  const check = await canDowngrade(session.user.enterprise_id, targetTier);
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (targetTier === 'lite' && sub?.stripe_subscription_id) {
    // Cancel at period end
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } else if (sub?.stripe_subscription_id) {
    // Downgrade to lower paid tier — schedule change at next billing cycle
    const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

    const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
    }

    // Release any existing schedule before creating a new one
    if (stripeSubscription.schedule) {
      const schedId = typeof stripeSubscription.schedule === 'string'
        ? stripeSubscription.schedule
        : stripeSubscription.schedule.id;
      try {
        await stripe.subscriptionSchedules.release(schedId);
      } catch {
        // Schedule may already be released or completed
      }
    }

    // Create schedule from the current subscription
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: sub.stripe_subscription_id,
    });

    // Use billing_cycle_anchor as the transition point (next billing date)
    const billingAnchor = stripeSubscription.billing_cycle_anchor;

    await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: [{ price: stripeSubscription.items.data[0].price.id, quantity: 1 }],
          end_date: billingAnchor,
        },
        {
          items: [{ price: priceId, quantity: 1 }],
          start_date: billingAnchor,
        },
      ],
    });
  }

  // Update tier in our DB immediately (don't wait for webhook)
  const { data: subRecord } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (subRecord) {
    await supabaseAdmin.rpc('update_subscription_tier', {
      p_sub_id: subRecord.id,
      p_enterprise_id: session.user.enterprise_id,
      p_tier: targetTier,
      p_status: targetTier === 'lite' ? 'canceling' : 'active',
      p_period_start: null,
      p_period_end: null,
    });
  }

  return NextResponse.json({ success: true, effective: 'end_of_period' });
}
