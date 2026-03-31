import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/billing/sync
 * Syncs subscription state from Stripe to our DB.
 * Used as a fallback when webhooks haven't fired yet (e.g., local dev).
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No Stripe customer' }, { status: 400 });
  }

  // Fetch subscriptions from Stripe (include all non-canceled statuses)
  let stripeSub = null;
  for (const status of ['active', 'trialing', 'past_due', 'incomplete'] as const) {
    const stripeSubs = await stripe.subscriptions.list({
      customer: sub.stripe_customer_id,
      status,
      limit: 1,
    });
    if (stripeSubs.data.length) {
      stripeSub = stripeSubs.data[0];
      break;
    }
  }

  let tier: string;

  if (stripeSub) {
    // Get the tier from the product metadata
    const item = stripeSub.items.data[0];
    const product = await stripe.products.retrieve(item.price.product as string);
    tier = product.metadata.tier || 'starter';
  } else {
    // Fallback: check the most recent completed checkout session for this customer
    const sessions = await stripe.checkout.sessions.list({
      customer: sub.stripe_customer_id,
      limit: 1,
    });
    const recentSession = sessions.data[0];
    if (recentSession?.metadata?.target_tier && recentSession.status === 'complete') {
      tier = recentSession.metadata.target_tier;
    } else {
      return NextResponse.json({ synced: false, message: 'No Stripe subscription found' });
    }
  }

  // Update our DB atomically
  await supabaseAdmin.rpc('update_subscription_tier', {
    p_sub_id: sub.id,
    p_enterprise_id: session.user.enterprise_id,
    p_tier: tier,
    p_status: stripeSub?.status || 'active',
    p_period_start: stripeSub ? new Date(stripeSub.current_period_start * 1000).toISOString() : null,
    p_period_end: stripeSub ? new Date(stripeSub.current_period_end * 1000).toISOString() : null,
  });

  // Also store the Stripe subscription ID if missing
  if (stripeSub && !sub.stripe_subscription_id) {
    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_subscription_id: stripeSub.id })
      .eq('id', sub.id);
  }

  return NextResponse.json({ synced: true, tier });
}
