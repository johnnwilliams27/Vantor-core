'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { TierComparisonGrid } from './TierComparisonGrid';
import { TierSlug, TIERS, isUpgrade } from '@/lib/billing/tiers';

export function PlanTab() {
  const { data: session, update: updateSession } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
    enabled: TIERS[tier].liveMode,
  });

  const handleSelectTier = async (targetTier: TierSlug) => {
    if (targetTier === tier) return;

    if (isUpgrade(tier, targetTier)) {
      // Redirect to upgrade flow (KYB -> KYC -> Checkout)
      window.location.href = `/settings/billing?upgrade=${targetTier}`;
    } else {
      // Downgrade via PATCH
      const res = await fetch('/api/billing/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTier }),
      });

      if (res.ok) {
        await updateSession();
      } else {
        const data = await res.json();
        alert(data.error || 'Downgrade failed');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Current plan summary */}
      <div className="rounded-xl border border-border p-6 bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <p className="text-xl font-bold mt-1">{TIERS[tier].name}</p>
            <p className="text-sm text-muted-foreground">{TIERS[tier].displayPrice}</p>
          </div>
          {tier === 'lite' && (
            <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-sm font-medium">
              Upgrade to unlock live mode
            </div>
          )}
        </div>

        {/* Asset cap bar */}
        {assetCap && assetCap.assetCap && (
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Asset Usage</span>
              <span>
                ${(assetCap.totalAssets / 1_000_000).toFixed(1)}M of $
                {(assetCap.assetCap / 1_000_000).toFixed(0)}M
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  assetCap.atCap ? 'bg-red-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, assetCap.utilizationPercent)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tier comparison */}
      <TierComparisonGrid currentTier={tier} onSelectTier={handleSelectTier} />
    </div>
  );
}
