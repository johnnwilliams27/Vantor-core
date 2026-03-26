'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { AlertTriangle } from 'lucide-react';
import { TierSlug, TIERS } from '@/lib/billing/tiers';
import Link from 'next/link';

export function AssetCapBanner() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
    enabled: TIERS[tier].liveMode && TIERS[tier].assetCapUsd !== null,
    refetchInterval: 60000, // check every minute
  });

  if (!assetCap?.atCap) return null;

  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
        <span className="text-sm font-medium text-red-500">
          You&apos;ve reached your asset cap. Upgrade to continue.
        </span>
      </div>
      <Link
        href="/settings/billing"
        className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
      >
        Upgrade
      </Link>
    </div>
  );
}
