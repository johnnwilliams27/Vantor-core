import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

// GET — current payment method
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabaseAdmin = createAdminClient();

  const { data: pm } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('is_default', true)
    .single();

  return NextResponse.json({ paymentMethod: pm || null });
}

// POST — create Stripe SetupIntent for adding/updating card
export async function POST() {
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
    return NextResponse.json({ error: 'No Stripe customer' }, { status: 400 });
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: sub.stripe_customer_id,
    payment_method_types: ['card'],
  });

  return NextResponse.json({ clientSecret: setupIntent.client_secret });
}
