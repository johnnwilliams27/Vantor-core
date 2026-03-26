import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { getTotalLiveAssets, getAssetCap } from '@/lib/billing/gate';
import { TierSlug } from '@/lib/billing/tiers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tier = session.user.subscription_tier as TierSlug;
  const cap = getAssetCap(tier);
  const total = await getTotalLiveAssets(session.user.enterprise_id);

  return NextResponse.json({
    totalAssets: total,
    assetCap: cap,
    atCap: cap !== null && total >= cap,
    utilizationPercent: cap ? Math.min(100, (total / cap) * 100) : null,
  });
}
