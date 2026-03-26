'use client';

import { TIERS, TIER_ORDER, TierSlug } from '@/lib/billing/tiers';
import { Check, X } from 'lucide-react';

interface TierComparisonGridProps {
  currentTier: TierSlug;
  onSelectTier: (tier: TierSlug) => void;
}

export function TierComparisonGrid({ currentTier, onSelectTier }: TierComparisonGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {TIER_ORDER.map((slug) => {
        const tier = TIERS[slug];
        const isCurrent = slug === currentTier;

        return (
          <div
            key={slug}
            className={`rounded-xl border p-5 flex flex-col ${
              isCurrent
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-border hover:border-primary/40 transition-colors'
            }`}
          >
            <h3 className="font-semibold text-lg">{tier.name}</h3>
            <p className="text-2xl font-bold mt-2">{tier.displayPrice}</p>

            <ul className="mt-4 space-y-2 flex-1 text-sm">
              <FeatureRow enabled={true} label="Test mode" />
              <FeatureRow enabled={tier.liveMode} label="Live mode" />
              <FeatureRow
                enabled={true}
                label={tier.assetCapUsd ? `$${(tier.assetCapUsd / 1_000_000).toFixed(0)}M asset cap` : 'Unlimited assets'}
              />
              <FeatureRow enabled={tier.liveMode} label={`${tier.includedErps} live ERP${tier.includedErps !== 1 ? 's' : ''} included`} />
            </ul>

            <div className="mt-4">
              {isCurrent ? (
                <div className="text-center text-sm font-medium text-primary py-2">
                  Current Plan
                </div>
              ) : slug === 'enterprise' ? (
                <a
                  href="mailto:sales@vantor.xyz?subject=Enterprise%20Plan%20Inquiry"
                  className="block text-center py-2 px-4 rounded-lg border border-primary text-primary hover:bg-primary/5 text-sm font-medium transition-colors"
                >
                  Contact Us
                </a>
              ) : (
                <button
                  onClick={() => onSelectTier(slug)}
                  className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:opacity-90 transition-opacity"
                >
                  {TIER_ORDER.indexOf(slug) > TIER_ORDER.indexOf(currentTier) ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureRow({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {enabled ? (
        <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <X className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
      )}
      <span className={enabled ? '' : 'text-muted-foreground/60'}>{label}</span>
    </li>
  );
}
