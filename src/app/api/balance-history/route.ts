import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

/**
 * GET /api/balance-history
 * Returns daily treasury totals: { date, fiat, stablecoin, total }[]
 * Uses balance_snapshots for crypto history + current fiat balance.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const userId = session.user.id;

  // --- Fiat: current bank balances ---
  let bankQuery = supabase
    .from('bank_accounts')
    .select('current_balance, balance_currency')
    .eq('is_active', true);
  if (enterpriseId) {
    bankQuery = bankQuery.eq('enterprise_id', enterpriseId);
  } else {
    bankQuery = bankQuery.eq('user_id', userId);
  }
  const { data: banks } = await bankQuery;

  let totalFiatUsd = 0;
  for (const b of banks ?? []) {
    if (b.current_balance) {
      totalFiatUsd += parseFloat(b.current_balance as string);
    }
  }

  // --- Crypto: get wallets for this enterprise ---
  let walletQuery = supabase.from('wallets').select('id');
  if (enterpriseId) {
    walletQuery = walletQuery.eq('enterprise_id', enterpriseId);
  } else {
    walletQuery = walletQuery.eq('user_id', userId);
  }
  const { data: wallets } = await walletQuery;
  const walletIds = (wallets ?? []).map((w) => w.id);

  // Try balance_snapshots (historical)
  let cryptoByDate: Record<string, number> = {};

  if (walletIds.length) {
    const { data: snaps } = await supabase
      .from('balance_snapshots')
      .select('token, balance, usd_value, snapped_at')
      .in('wallet_id', walletIds)
      .order('snapped_at', { ascending: true })
      .limit(2000);

    if (snaps?.length) {
      for (const s of snaps) {
        const day = s.snapped_at.split('T')[0];
        const val = s.usd_value ? parseFloat(s.usd_value as string) : parseFloat(s.balance as string);
        cryptoByDate[day] = (cryptoByDate[day] ?? 0) + val;
      }
    }
  }

  // If no snapshots, fall back to wallet_balances (current state)
  if (!Object.keys(cryptoByDate).length && walletIds.length) {
    const { data: balances } = await supabase
      .from('wallet_balances')
      .select('token, balance, usd_value')
      .in('wallet_id', walletIds);

    if (balances?.length) {
      const today = new Date().toISOString().split('T')[0];
      let total = 0;
      for (const b of balances) {
        total += b.usd_value ? parseFloat(b.usd_value as string) : parseFloat(b.balance as string);
      }
      cryptoByDate[today] = total;
    }
  }

  // If we still have no crypto data, just show fiat as a single point
  if (!Object.keys(cryptoByDate).length && totalFiatUsd > 0) {
    const today = new Date().toISOString().split('T')[0];
    return NextResponse.json({
      data: [{ date: today, fiat: round(totalFiatUsd), stablecoin: 0, total: round(totalFiatUsd) }],
    });
  }

  if (!Object.keys(cryptoByDate).length) {
    return NextResponse.json({ data: [] });
  }

  // Filter by time range if provided
  const range = req.nextUrl.searchParams.get('range') ?? '3m';
  const rangeMs: Record<string, number> = {
    '1d': 1 * 86_400_000,
    '7d': 7 * 86_400_000,
    '1m': 30 * 86_400_000,
    '3m': 90 * 86_400_000,
    '6m': 180 * 86_400_000,
  };
  const cutoff = new Date(Date.now() - (rangeMs[range] ?? rangeMs['3m']));
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Build combined series: fiat is constant (we only have current balance),
  // stablecoin varies by day from snapshots
  const chartData = Object.entries(cryptoByDate)
    .filter(([date]) => date >= cutoffStr)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, stablecoin]) => ({
      date,
      fiat: round(totalFiatUsd),
      stablecoin: round(stablecoin),
      total: round(totalFiatUsd + stablecoin),
    }));

  return NextResponse.json({ data: chartData });
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
