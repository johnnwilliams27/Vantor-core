'use client';

import { useState, type ReactNode } from 'react';
import { Lock, Sparkles, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface UpgradeGateProps {
  children: ReactNode;
  feature?: string;
}

/**
 * Wraps an action button. For Lite tier users, replaces the action with
 * a teal gradient CTA that expands into an inline upgrade banner.
 * For paid tiers, renders children as-is.
 */
export function UpgradeGate({ children, feature }: UpgradeGateProps) {
  const { data: session } = useSession();
  const tier = session?.user?.subscription_tier ?? 'lite';
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  if (tier !== 'lite') return <>{children}</>;

  if (!expanded) {
    return (
      <Button
        size="sm"
        className="gap-1.5 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
        onClick={() => setExpanded(true)}
      >
        <Lock className="h-3.5 w-3.5" />
        Upgrade Now
      </Button>
    );
  }

  return (
    <div className="relative w-full mt-3 rounded-lg border border-teal-500/20 bg-gradient-to-br from-teal-950/40 via-[#0a1628] to-[#0a1628] p-4 overflow-hidden">
      {/* Subtle glow effect */}
      <div className="absolute top-0 left-0 w-32 h-32 bg-teal-500/5 rounded-full blur-2xl -translate-x-1/2 -translate-y-1/2" />

      <button
        onClick={() => setExpanded(false)}
        className="absolute top-3 right-3 text-gray-500 hover:text-gray-300 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center shrink-0 shadow-lg shadow-teal-500/20">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">
            Unlock {feature || 'this feature'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Upgrade to a paid plan for live connections, DeFi yields, ramps, and more.
          </p>
          <Button
            size="sm"
            className="mt-3 gap-1.5 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
            onClick={() => router.push('/settings/billing')}
          >
            View Plans
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
