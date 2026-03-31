'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { TierComparisonGrid } from './TierComparisonGrid';
import { UpgradeFlow } from './UpgradeFlow';
import { DowngradeConfirmModal } from './DowngradeConfirmModal';
import { TierSlug, TIERS, isUpgrade as isUpgradeFn } from '@/lib/billing/tiers';

export function PlanTab() {
  const { data: session, update: updateSession } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;
  const [upgradeTier, setUpgradeTier] = useState<TierSlug | null>(null);
  const [downgradeTier, setDowngradeTier] = useState<TierSlug | null>(null);

  const kybDone = session?.user?.kyb_status === 'completed';
  const kycDone = session?.user?.kyc_status === 'completed';
  const isLite = tier === 'lite';
  const showResumeBanner = isLite && (kybDone || kycDone);

  let resumeMessage = '';
  let resumeCta = '';
  if (kybDone && kycDone) {
    resumeMessage = 'Verification complete — finish your upgrade';
    resumeCta = 'Complete Upgrade';
  } else if (kybDone) {
    resumeMessage = 'Business verification complete — continue with identity verification';
    resumeCta = 'Continue Upgrade';
  }

  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
    enabled: TIERS[tier].liveMode,
  });

  const handleSelectTier = async (targetTier: TierSlug) => {
    if (targetTier === tier) return;

    if (isUpgradeFn(tier, targetTier)) {
      setUpgradeTier(targetTier);
    } else {
      setDowngradeTier(targetTier);
    }
  };

  const handleDowngradeConfirm = async () => {
    if (!downgradeTier) return;
    const res = await fetch('/api/billing/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetTier: downgradeTier }),
    });

    if (res.ok) {
      await updateSession();
      setDowngradeTier(null);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Downgrade failed');
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

      {/* Resume upgrade banner */}
      {showResumeBanner && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <ArrowRight className="w-4 h-4 text-primary" />
            </div>
            <p className="text-sm text-foreground">{resumeMessage}</p>
          </div>
          <button
            onClick={() => setUpgradeTier('starter')}
            className="px-4 py-2 rounded-lg bg-[#19595b] hover:bg-[#134849] text-white text-sm font-medium transition-colors flex-shrink-0"
          >
            {resumeCta}
          </button>
        </div>
      )}

      {/* Tier comparison */}
      <TierComparisonGrid currentTier={tier} onSelectTier={handleSelectTier} />

      {/* Upgrade flow modal */}
      {upgradeTier && (
        <UpgradeFlow
          targetTier={upgradeTier}
          onCancel={() => setUpgradeTier(null)}
        />
      )}

      {/* Downgrade confirm modal */}
      {downgradeTier && (
        <DowngradeConfirmModal
          currentTier={tier}
          targetTier={downgradeTier}
          onConfirm={handleDowngradeConfirm}
          onCancel={() => setDowngradeTier(null)}
        />
      )}
    </div>
  );
}
