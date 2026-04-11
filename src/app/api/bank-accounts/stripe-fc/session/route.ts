import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { createFCSession } from '@/lib/banking/stripe-fc';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/billing/stripe';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const mode = getIntegrationMode(session.user.subscription_tier);

  // Financial Connections sessions must be bound to a concrete account holder.
  // Use the enterprise's Stripe customer ID (created during subscription
  // checkout). If no customer exists yet — e.g. for an enterprise that took an
  // edge-case path to paid — create one on the fly so linking still works.
  const supabaseAdmin = createAdminClient();
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .maybeSingle();

  let stripeCustomerId = sub?.stripe_customer_id ?? null;

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
      .upsert(
        {
          enterprise_id: session.user.enterprise_id,
          tier: (session.user.subscription_tier as string) || 'lite',
          status: 'active',
          stripe_customer_id: stripeCustomerId,
        },
        { onConflict: 'enterprise_id' },
      );
  }

  try {
    const { clientSecret } = await createFCSession(mode, stripeCustomerId);
    return NextResponse.json({ data: { clientSecret } });
  } catch (err) {
    console.error('[stripe-fc/session]', err);
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to create session' },
      { status: 500 },
    );
  }
}
