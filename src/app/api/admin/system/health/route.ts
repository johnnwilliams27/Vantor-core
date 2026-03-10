import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.is_app_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createAdminClient();

  try {
    // Count enterprises
    const { count: totalEnterprises, error: entError } = await supabase
      .from('enterprises')
      .select('id', { count: 'exact', head: true });

    if (entError) return NextResponse.json({ error: entError.message }, { status: 500 });

    // Count users
    const { count: totalUsers, error: userError } = await supabase
      .from('user_profiles')
      .select('id', { count: 'exact', head: true });

    if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });

    // Count transactions (count only — NO amounts)
    const { count: totalTransactions, error: txError } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true });

    if (txError) return NextResponse.json({ error: txError.message }, { status: 500 });

    // Count frozen enterprises
    const { count: frozenEnterprises, error: frzError } = await supabase
      .from('enterprises')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'frozen');

    if (frzError) return NextResponse.json({ error: frzError.message }, { status: 500 });

    return NextResponse.json({
      data: {
        total_enterprises: totalEnterprises ?? 0,
        total_users: totalUsers ?? 0,
        total_transactions: totalTransactions ?? 0,
        frozen_enterprises: frozenEnterprises ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
