import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { getYieldAdapter, ALL_YIELD_PROTOCOLS } from '@/lib/yield/factory';
import type { YieldRate } from '@/lib/yield/interface';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('yield-rates', session.user.id, 30, 3600_000)) {
    return rateLimitResponse();
  }

  const supabase = createAdminClient();

  // Try cache first
  const { data: cached } = await supabase
    .from('yield_rate_cache')
    .select('*')
    .order('protocol');

  if (cached && cached.length > 0) {
    // Filter Ondo for non-US enterprises only
    const enterpriseId = session.user.enterprise_id;
    let enterpriseCountry: string | null = null;
    if (enterpriseId) {
      const { data: ent } = await supabase
        .from('enterprises')
        .select('country')
        .eq('id', enterpriseId)
        .single();
      enterpriseCountry = ent?.country ?? null;
    }

    const rates = cached
      .filter((row) => {
        // Hide Ondo if enterprise is US or has no country set
        if (row.protocol === 'ondo') {
          return enterpriseCountry && enterpriseCountry !== 'US';
        }
        return true;
      })
      .map((row) => ({
        protocol: row.protocol,
        token: row.token,
        chain: row.chain,
        supplyAPY: Number(row.supply_apy),
        rewardAPY: Number(row.reward_apy),
        totalAPY: Number(row.total_apy),
        fetchedAt: row.fetched_at,
        isStale: row.is_stale,
      }));

    return NextResponse.json({ data: rates });
  }

  // Fallback to mock data if cache is empty (cron hasn't run yet)
  const rates = await Promise.all(
    ALL_YIELD_PROTOCOLS.flatMap((pid) => {
      const adapter = getYieldAdapter(pid);
      const info = adapter.getInfo();
      return info.supportedTokens.map((t) => adapter.getAPY(t));
    }),
  );

  return NextResponse.json({ data: rates.map((r) => ({ ...r, isStale: false })) });
}
