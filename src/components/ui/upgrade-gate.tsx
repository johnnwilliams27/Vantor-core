'use client';

import { useState, type ReactNode } from 'react';
import { Lock, ArrowRight, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

interface UpgradeGateProps {
  children: ReactNode;
  feature?: string;
}

/**
 * Wraps an action button. For Lite tier users, replaces the action with
 * an upgrade text link that expands into an inline upgrade banner.
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
      <button
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors flex items-center gap-1.5 border border-teal-500/30 rounded-full px-3 py-1"
      >
        <Lock className="h-3 w-3" />
        Upgrade to unlock
      </button>
    );
  }

  return (
    <div className="relative w-full mt-3 rounded-lg border border-border bg-muted/30 p-4 overflow-hidden">
      <button
        onClick={() => setExpanded(false)}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative">
        <p className="text-sm font-medium text-foreground">
          Unlock {feature || 'this feature'}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Upgrade to a paid plan for live connections, DeFi yields, ramps, and more.
        </p>
        <button
          onClick={() => router.push('/settings/billing')}
          className="mt-3 text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors flex items-center gap-1"
        >
          View plans
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
