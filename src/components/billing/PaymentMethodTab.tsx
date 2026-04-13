'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { CreditCard } from 'lucide-react';
import { TierSlug, isPaidTier } from '@/lib/billing/tiers';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/spinner';

export function PaymentMethodTab() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data, isLoading } = useQuery({
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

  if (isLoading) {
    return <PaymentMethodSkeleton />;
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
              <p className="font-medium">
                <span className="capitalize">{pm.card_brand}</span> &bull;&bull;&bull;&bull; {pm.card_last4}
              </p>
              <p className="text-sm text-muted-foreground">
                Expires {pm.card_exp_month}/{pm.card_exp_year}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleUpdateCard}>
            Update Card
          </Button>
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-muted-foreground mb-3">No payment method on file.</p>
          <Button size="sm" onClick={handleUpdateCard}>
            Add Payment Method
          </Button>
        </div>
      )}
    </div>
  );
}

function PaymentMethodSkeleton() {
  return (
    <div className="rounded-xl border border-border p-6 bg-card" role="status" aria-label="Loading payment method">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}
