'use client';

import { TIERS, TIER_ORDER, TierSlug } from '@/lib/billing/tiers';
import { Check, X, Sparkles, Zap, TrendingUp, Rocket, Building2, ArrowRight, MessageSquare } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Badge } from '@/components/ui/badge';

const TRANSACTION_TOOLTIP =
  'A transaction is any on-chain or off-chain movement of funds billed through Vantor: Payments, Transfers, Swaps, Bridges, and Ramps. The 0.25% fee applies per event.';

const TIER_CONFIG: Record<TierSlug, {
  icon: typeof Sparkles;
  gradient: string;
  iconBg: string;
  popular?: boolean;
}> = {
  lite: {
    icon: Sparkles,
    gradient: 'from-slate-500/20 to-slate-600/10',
    iconBg: 'bg-slate-500/10 text-slate-400',
  },
  starter: {
    icon: Zap,
    gradient: 'from-blue-500/20 to-blue-600/10',
    iconBg: 'bg-blue-500/10 text-blue-400',
  },
  growth: {
    icon: TrendingUp,
    gradient: 'from-teal-500/20 to-cyan-500/10',
    iconBg: 'bg-teal-500/10 text-teal-400',
    popular: true,
  },
  scale: {
    icon: Rocket,
    gradient: 'from-purple-500/20 to-purple-600/10',
    iconBg: 'bg-purple-500/10 text-purple-400',
  },
  enterprise: {
    icon: Building2,
    gradient: 'from-amber-500/20 to-orange-500/10',
    iconBg: 'bg-amber-500/10 text-amber-400',
  },
};

interface TierComparisonGridProps {
  currentTier: TierSlug;
  onSelectTier: (tier: TierSlug) => void;
  pendingDowngradeTier?: TierSlug;
}

export function TierComparisonGrid({ currentTier, onSelectTier, pendingDowngradeTier }: TierComparisonGridProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {TIER_ORDER.map((slug) => {
        const tier = TIERS[slug];
        const config = TIER_CONFIG[slug];
        const Icon = config.icon;
        const isCurrent = slug === currentTier;
        const isUpgrade = TIER_ORDER.indexOf(slug) > TIER_ORDER.indexOf(currentTier);

        return (
          <div
            key={slug}
            className={`relative rounded-xl border p-4 flex flex-col transition-colors duration-200 ${
              isCurrent
                ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                : 'border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5'
            }`}
          >
            {/* Popular badge */}
            {config.popular && !isCurrent && (
              <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 text-white text-3xs font-bold uppercase tracking-wider whitespace-nowrap">
                Popular
              </div>
            )}

            {/* Icon + gradient header */}
            <div className={`rounded-lg bg-gradient-to-br ${config.gradient} p-3 mb-3 flex items-center justify-center`}>
              <div className={`w-9 h-9 rounded-lg ${config.iconBg} flex items-center justify-center`}>
                <Icon className="w-4.5 h-4.5" />
              </div>
            </div>

            <h3 className="font-semibold text-base">{tier.name}</h3>
            <p className="text-xl font-bold mt-1 tabular-nums">{tier.displayPrice}</p>

            <ul className="mt-3 space-y-1.5 flex-1 text-xs">
              <FeatureRow enabled={true} label="Test mode" />
              <FeatureRow enabled={tier.liveMode} label="Live mode" />
              <FeatureRow
                enabled={true}
                label={tier.assetCapUsd ? `Up to $${(tier.assetCapUsd / 1_000_000).toFixed(0)}M AUM` : 'Unlimited AUM'}
              />
              <FeatureRow enabled={tier.liveMode} label={`${tier.includedErps} live ERP`} />
              <FeatureRow
                enabled={tier.liveMode}
                label="0.25% per transaction"
                tooltip={TRANSACTION_TOOLTIP}
              />
            </ul>

            <div className="mt-3">
              {isCurrent ? (
                <Badge variant="active" className="w-full justify-center py-1.5 text-xs font-semibold">
                  Current Plan
                </Badge>
              ) : slug === 'enterprise' ? (
                <a
                  href="mailto:sales@vantor.xyz?subject=Enterprise%20Plan%20Inquiry"
                  className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/50 text-xs font-semibold transition-colors duration-200"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Contact Sales
                </a>
              ) : isUpgrade ? (
                <button
                  onClick={() => onSelectTier(slug)}
                  className="btn-gradient flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs"
                >
                  Upgrade
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : pendingDowngradeTier ? (
                <div className="text-center text-xs text-muted-foreground/50 py-2 px-3 rounded-lg border border-border/50 bg-muted/30">
                  {slug === pendingDowngradeTier ? 'Downgrade pending' : 'Downgrade'}
                </div>
              ) : (
                <button
                  onClick={() => onSelectTier(slug)}
                  className="w-full py-2 px-3 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-border/80 text-xs font-medium transition-colors duration-200"
                >
                  Downgrade
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureRow({
  enabled,
  label,
  tooltip,
}: {
  enabled: boolean;
  label: string;
  tooltip?: string;
}) {
  return (
    <li className="flex items-center gap-1.5">
      {enabled ? (
        <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
      ) : (
        <X className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
      )}
      <span className={enabled ? 'text-foreground' : 'text-muted-foreground/50'}>{label}</span>
      {tooltip && <InfoTooltip content={tooltip} />}
    </li>
  );
}
