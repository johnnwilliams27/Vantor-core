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

  // Check Stripe for pending downgrade (schedule or cancel_at_period_end)
  let pendingDowngrade: { targetTier: string; effectiveDate: string } | null = null;

  if (sub.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

      if (stripeSub.cancel_at_period_end) {
        // Downgrade to Lite (cancellation)
        const anchor = stripeSub.billing_cycle_anchor;
        pendingDowngrade = {
          targetTier: 'lite',
          effectiveDate: new Date(anchor * 1000).toISOString(),
        };
      } else if (stripeSub.schedule) {
        // Downgrade to a lower paid tier (schedule)
        const schedId = typeof stripeSub.schedule === 'string'
          ? stripeSub.schedule : stripeSub.schedule.id;
        const schedule = await stripe.subscriptionSchedules.retrieve(schedId);

        if (schedule.status === 'active' && schedule.phases.length > 1) {
          const nextPhase = schedule.phases[1];
          const nextPriceId = nextPhase.items[0]?.price;

          // Resolve tier from price ID
          let nextTier = 'unknown';
          for (const slug of ['starter', 'growth', 'scale', 'enterprise'] as const) {
            if (process.env[`STRIPE_PRICE_${slug.toUpperCase()}`] === nextPriceId) {
              nextTier = slug;
              break;
            }
          }

          // Only show as pending downgrade if next tier is lower
          if (isDowngrade(sub.tier as TierSlug, nextTier as TierSlug)) {
            pendingDowngrade = {
              targetTier: nextTier,
              effectiveDate: new Date(nextPhase.start_date * 1000).toISOString(),
            };
          }
        }
      }
    } catch {
      // Stripe lookup failed — proceed without pending info
    }
  }

  return NextResponse.json({
    ...sub,
    tierDetails: tier,
    pendingDowngrade,
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

  // Verify KYB + KYC — only required for Lite → paid upgrades.
  // Paid-to-paid upgrades skip this since verification was done on initial upgrade.
  if (!isPaidTier(currentTier)) {
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

    // Clear any pending downgrade before upgrading
    if (stripeSubscription.cancel_at_period_end) {
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: false,
      });
    }
    if (stripeSubscription.schedule) {
      const schedId = typeof stripeSubscription.schedule === 'string'
        ? stripeSubscription.schedule : stripeSubscription.schedule.id;
      try {
        await stripe.subscriptionSchedules.release(schedId);
      } catch { /* already released */ }
    }

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

  if (!sub?.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

  // Release any existing schedule first (required before any modification)
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

  const billingAnchor = stripeSubscription.billing_cycle_anchor;
  const effectiveDate = new Date(billingAnchor * 1000).toISOString();

  if (targetTier === 'lite') {
    // Cancel at period end (billing anchor)
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } else {
    // Downgrade to lower paid tier — schedule change at billing anchor
    const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
    }

    try {
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: sub.stripe_subscription_id,
      });

      const subStart = (stripeSubscription as any).start_date as number;

      await stripe.subscriptionSchedules.update(schedule.id, {
        phases: [
          {
            items: [{ price: stripeSubscription.items.data[0].price.id, quantity: 1 }],
            start_date: subStart,
            end_date: billingAnchor,
          },
          {
            items: [{ price: priceId, quantity: 1 }],
            start_date: billingAnchor,
          },
        ],
      });
    } catch (err: any) {
      console.error('[downgrade] Stripe schedule error:', err.message);
      return NextResponse.json({ error: `Stripe error: ${err.message}` }, { status: 500 });
    }
  }

  // Do NOT update the tier in DB immediately — the actual change happens at billing anchor.
  // The webhook (subscription.updated or subscription.deleted) will handle the tier update.
  // Just return the effective date so the UI can show it.
  return NextResponse.json({ success: true, effective: 'end_of_period', effectiveDate });
}

// DELETE — cancel a pending downgrade
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub?.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

  // Cancel pending Lite downgrade (undo cancel_at_period_end)
  if (stripeSub.cancel_at_period_end) {
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
    return NextResponse.json({ success: true });
  }

  // Cancel pending paid-tier downgrade (release schedule)
  if (stripeSub.schedule) {
    const schedId = typeof stripeSub.schedule === 'string'
      ? stripeSub.schedule : stripeSub.schedule.id;
    await stripe.subscriptionSchedules.release(schedId);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'No pending downgrade to cancel' }, { status: 400 });
}
