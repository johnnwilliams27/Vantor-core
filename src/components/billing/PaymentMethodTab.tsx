'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { CreditCard } from 'lucide-react';
import { TierSlug, isPaidTier } from '@/lib/billing/tiers';

export function PaymentMethodTab() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data } = useQuery({
    queryKey: ['payment-method'],
    queryFn: () => fetch('/api/billing/payment-method').then(r => r.json()),
    enabled: isPaidTier(tier),
  });

  if (!isPaidTier(tier)) {
    return (
      <div className="text-center py-12">
        <CreditCard className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-muted-foreground">
          Add a payment method when you upgrade to a paid plan.
        </p>
      </div>
    );
  }

  const pm = data?.paymentMethod;

  const handleUpdateCard = async () => {
    const res = await fetch('/api/billing/payment-method', { method: 'POST' });
    const { clientSecret } = await res.json();
    // Open Stripe Elements or redirect to Stripe-hosted page
    // This will be wired up with @stripe/react-stripe-js
    console.log('Setup intent created:', clientSecret);
  };

  return (
    <div className="rounded-xl border border-border p-6 bg-card">
      {pm ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="w-8 h-8 text-muted-foreground" />
            <div>
              <p className="font-medium capitalize">{pm.card_brand} &bull;&bull;&bull;&bull; {pm.card_last4}</p>
              <p className="text-sm text-muted-foreground">
                Expires {pm.card_exp_month}/{pm.card_exp_year}
              </p>
            </div>
          </div>
          <button
            onClick={handleUpdateCard}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Update Card
          </button>
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-muted-foreground mb-3">No payment method on file.</p>
          <button
            onClick={handleUpdateCard}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
          >
            Add Payment Method
          </button>
        </div>
      )}
    </div>
  );
}
