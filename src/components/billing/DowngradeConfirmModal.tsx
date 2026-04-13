'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { TierSlug, TIERS } from '@/lib/billing/tiers';
import { ArrowDown, AlertTriangle, Loader2 } from 'lucide-react';

interface DowngradeConfirmModalProps {
  currentTier: TierSlug;
  targetTier: TierSlug;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function DowngradeConfirmModal({
  currentTier,
  targetTier,
  onConfirm,
  onCancel,
}: DowngradeConfirmModalProps) {
  const [mounted, setMounted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Fetch subscription to get current period end date
  const { data: subscription } = useQuery({
    queryKey: ['subscription-details'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
  });

  // Fetch asset utilization to check against target tier cap
  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
  });

  const targetDef = TIERS[targetTier];
  const currentDef = TIERS[currentTier];

  const totalAssets = assetCap?.totalAssets || 0;
  const targetCapUsd = targetDef.assetCapUsd;
  const exceedsCap = targetCapUsd !== null && totalAssets > targetCapUsd;

  // Format the effective date
  let effectiveDate = 'end of your current billing period';
  if (subscription?.current_period_end) {
    const date = new Date(subscription.current_period_end);
    if (!isNaN(date.getTime())) {
      effectiveDate = date.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-[background-color,backdrop-filter] duration-400 ${
        mounted ? 'bg-black/40 backdrop-blur-[3px]' : 'bg-black/0 backdrop-blur-0'
      }`}
    >
      <div
        className={`bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transition-[opacity,transform] duration-500 ${
          mounted ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-6'
        }`}
      >
        {/* Header */}
        <div className="bg-amber-600/90 px-6 py-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent animate-[shimmer_8s_ease-in-out_infinite]" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <ArrowDown className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Downgrade to {targetDef.name}
              </h2>
              <p className="text-xs text-white/60">
                {currentDef.displayPrice} &rarr; {targetDef.displayPrice}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {exceedsCap ? (
            <div>
              <div className="flex items-start gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <AlertTriangle className="w-4.5 h-4.5 text-red-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground mb-1">
                    Asset limit exceeded
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Your connected assets (${(totalAssets / 1_000_000).toFixed(1)}M) exceed the{' '}
                    {targetDef.name} plan cap of ${targetCapUsd ? (targetCapUsd / 1_000_000).toFixed(0) : '0'}M.
                    Please reduce your assets under management before downgrading.
                  </p>
                </div>
              </div>

              <button
                onClick={onCancel}
                className="w-full px-5 py-2.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
              >
                Go Back
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Your plan will be downgraded to <span className="text-foreground font-medium">{targetDef.name}</span> ({targetDef.displayPrice}) at the end of your current billing period on{' '}
                <span className="text-foreground font-medium">{effectiveDate}</span>.
                You&apos;ll continue to have access to {currentDef.name} features until then.
              </p>

              {targetTier === 'lite' && (
                <p className="text-sm text-amber-400/90 mb-4">
                  Downgrading to Lite will cancel your subscription and disable live mode access.
                </p>
              )}

              {targetCapUsd && (
                <div className="rounded-lg bg-muted/50 px-3 py-2.5 mb-4">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{targetDef.name}</span> asset cap: ${(targetCapUsd / 1_000_000).toFixed(0)}M
                    {totalAssets > 0 && (
                      <> &mdash; current usage: ${(totalAssets / 1_000_000).toFixed(1)}M</>
                    )}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onCancel}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors disabled:opacity-50"
                >
                  {confirming ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Processing...
                    </span>
                  ) : (
                    'Confirm Downgrade'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes shimmer {
          0%, 100% { transform: translateX(-100%); }
          50% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
