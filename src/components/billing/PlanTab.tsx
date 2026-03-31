'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { ArrowRight, Clock, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TierComparisonGrid } from './TierComparisonGrid';
import { UpgradeFlow } from './UpgradeFlow';
import { DowngradeConfirmModal } from './DowngradeConfirmModal';
import { TierSlug, TIERS, isUpgrade as isUpgradeFn } from '@/lib/billing/tiers';

export function PlanTab() {
  const { data: session, update: updateSession } = useSession();
  const queryClient = useQueryClient();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;
  const [upgradeTier, setUpgradeTier] = useState<TierSlug | null>(null);
  const [downgradeTier, setDowngradeTier] = useState<TierSlug | null>(null);
  const [cancelingDowngrade, setCancelingDowngrade] = useState(false);

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
  } else if (kycDone) {
    resumeMessage = 'Identity verification complete — continue with business verification';
    resumeCta = 'Continue Upgrade';
  }

  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
    enabled: TIERS[tier].liveMode,
  });

  // Fetch subscription details including pending downgrade
  const { data: subscriptionData } = useQuery({
    queryKey: ['subscription-details'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
    enabled: !isLite,
  });

  const pendingDowngrade = subscriptionData?.pendingDowngrade as {
    targetTier: string;
    effectiveDate: string;
  } | null;

  const pendingDowngradeName = pendingDowngrade
    ? TIERS[pendingDowngrade.targetTier as TierSlug]?.name || pendingDowngrade.targetTier
    : null;

  const pendingDowngradeDate = pendingDowngrade?.effectiveDate
    ? new Date(pendingDowngrade.effectiveDate).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      })
    : null;

  const handleSelectTier = async (targetTier: TierSlug) => {
    if (targetTier === tier) return;
    // Block downgrade selection if one is already pending
    if (pendingDowngrade && !isUpgradeFn(tier, targetTier)) return;

    if (isUpgradeFn(tier, targetTier)) {
      setUpgradeTier(targetTier);
    } else {
      setDowngradeTier(targetTier);
    }
  };

  const [downgradeBanner, setDowngradeBanner] = useState<string | null>(null);

  const handleDowngradeConfirm = async () => {
    if (!downgradeTier) return;
    const res = await fetch('/api/billing/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetTier: downgradeTier }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      setDowngradeTier(null);
      // Refetch subscription to pick up pendingDowngrade
      queryClient.invalidateQueries({ queryKey: ['subscription-details'] });
      const targetName = TIERS[downgradeTier]?.name || downgradeTier;
      if (data.effectiveDate) {
        const date = new Date(data.effectiveDate).toLocaleDateString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric',
        });
        setDowngradeBanner(`Downgrade to ${targetName} scheduled for ${date}.`);
      } else {
        setDowngradeBanner(`Downgrade to ${targetName} scheduled for end of billing period.`);
      }
    } else {
      alert(data.error || 'Downgrade failed');
    }
  };

  const handleCancelDowngrade = async () => {
    setCancelingDowngrade(true);
    try {
      const res = await fetch('/api/billing/subscription', { method: 'DELETE' });
      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ['subscription-details'] });
        setDowngradeBanner(null);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to cancel downgrade');
      }
    } finally {
      setCancelingDowngrade(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Pending downgrade banner */}
      {pendingDowngrade && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-foreground">
                Downgrade to <span className="font-medium">{pendingDowngradeName}</span> scheduled
                {pendingDowngradeDate && <> for <span className="font-medium">{pendingDowngradeDate}</span></>}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                You&apos;ll keep {TIERS[tier].name} features until then
              </p>
            </div>
          </div>
          <button
            onClick={handleCancelDowngrade}
            disabled={cancelingDowngrade}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors flex-shrink-0 disabled:opacity-50"
          >
            {cancelingDowngrade ? 'Canceling...' : 'Cancel Downgrade'}
          </button>
        </div>
      )}

      {/* One-time downgrade scheduled banner (shown right after scheduling) */}
      {downgradeBanner && !pendingDowngrade && (
        <div className="rounded-lg px-4 py-3 text-sm font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400 animate-[fadeSlideUp_0.3s_ease-out]">
          {downgradeBanner}
        </div>
      )}

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
      <TierComparisonGrid
        currentTier={tier}
        onSelectTier={handleSelectTier}
        pendingDowngradeTier={pendingDowngrade?.targetTier as TierSlug | undefined}
      />

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
