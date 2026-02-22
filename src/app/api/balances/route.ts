import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get wallets with their cached balances
  const { data: wallets, error: wErr } = await supabase
    .from('wallets')
    .select('id, address, chain')
    .eq('user_id', session.user.id);

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 });
  if (!wallets?.length) return NextResponse.json({ data: [] });

  const walletIds = wallets.map((w) => w.id);

  const { data: balances, error: bErr } = await supabase
    .from('wallet_balances')
    .select('*')
    .in('wallet_id', walletIds);

  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });

  // Merge wallet info into balance rows
  const walletMap = Object.fromEntries(wallets.map((w) => [w.id, w]));
  const result = (balances ?? []).map((b) => ({
    ...b,
    walletAddress: walletMap[b.wallet_id]?.address,
    chain: walletMap[b.wallet_id]?.chain,
  }));

  return NextResponse.json({ data: result });
}
