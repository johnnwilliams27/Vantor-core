'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { TIERS, TierSlug } from '@/lib/billing/tiers';

export function UsageTab() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data: usage, isLoading } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => fetch('/api/billing/usage').then(r => r.json()),
  });

  const { data: subscription } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading usage data...</div>;
  }

  const subscriptionCost = TIERS[tier].price ? TIERS[tier].price! / 100 : (subscription?.custom_price || 0);
  const erpAddonCost = usage?.erpAddonCost || 0;
  const totalFees = usage?.totalTransactionFees || 0;
  const totalEstimated = subscriptionCost + erpAddonCost + totalFees;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-6 bg-card">
        <h3 className="font-semibold mb-1">Current Billing Period</h3>
        <p className="text-sm text-muted-foreground">{usage?.billingPeriod || 'N/A'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryCard label="Subscription" value={`$${subscriptionCost.toLocaleString()}`} />
        <SummaryCard label="ERP Add-ons" value={`$${erpAddonCost.toLocaleString()}`} detail={`${usage?.erpAddons || 0} additional ERPs`} />
        <SummaryCard
          label="Ramp Fees"
          value={`$${(usage?.transactionFees?.ramp?.total || 0).toFixed(2)}`}
          detail={`${usage?.transactionFees?.ramp?.count || 0} transactions`}
        />
        <SummaryCard
          label="Swap Fees"
          value={`$${(usage?.transactionFees?.swap?.total || 0).toFixed(2)}`}
          detail={`${usage?.transactionFees?.swap?.count || 0} transactions`}
        />
        <SummaryCard
          label="Bridge Fees"
          value={`$${(usage?.transactionFees?.bridge?.total || 0).toFixed(2)}`}
          detail={`${usage?.transactionFees?.bridge?.count || 0} transactions`}
        />
      </div>

      <div className="rounded-xl border-2 border-primary/30 p-6 bg-primary/5">
        <div className="flex justify-between items-center">
          <span className="font-semibold">Estimated Total</span>
          <span className="text-2xl font-bold">${totalEstimated.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-border p-4 bg-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
    </div>
  );
}
