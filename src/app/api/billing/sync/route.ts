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

  console.log('[sync] enterprise_id:', session.user.enterprise_id, 'sub:', sub?.id, 'stripe_customer:', sub?.stripe_customer_id, 'current_tier:', sub?.tier);

  if (!sub?.stripe_customer_id) {
    console.log('[sync] FAIL: no stripe_customer_id on subscription');
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

  console.log('[sync] resolved tier:', tier, 'from:', stripeSub ? 'stripe_sub' : 'checkout_session');

  // Build period dates safely — Stripe API may return these differently across versions
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (stripeSub) {
    try {
      const startVal = (stripeSub as any).current_period_start;
      const endVal = (stripeSub as any).current_period_end;
      if (typeof startVal === 'number') periodStart = new Date(startVal * 1000).toISOString();
      if (typeof endVal === 'number') periodEnd = new Date(endVal * 1000).toISOString();
    } catch {
      // Period dates not critical — proceed without them
    }
  }

  // Update our DB atomically
  const { error: rpcError } = await supabaseAdmin.rpc('update_subscription_tier', {
    p_sub_id: sub.id,
    p_enterprise_id: session.user.enterprise_id,
    p_tier: tier,
    p_status: stripeSub?.status || 'active',
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });

  if (rpcError) {
    console.log('[sync] RPC ERROR:', rpcError);
    return NextResponse.json({ synced: false, error: rpcError.message }, { status: 500 });
  }
  console.log('[sync] SUCCESS: tier updated to', tier);

  // Also store the Stripe subscription ID if missing
  if (stripeSub && !sub.stripe_subscription_id) {
    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_subscription_id: stripeSub.id })
      .eq('id', sub.id);
  }

  return NextResponse.json({ synced: true, tier });
}
