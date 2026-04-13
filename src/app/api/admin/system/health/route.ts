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
    // Enterprises break into three disjoint buckets:
    //   - paid      = subscription_tier != 'lite' (starter/growth/scale/enterprise)
    //   - test      = enterprise whose id is referenced by another enterprise's
    //                 test_enterprise_id — the sandbox sibling that seed data targets.
    //                 seed.ts enforces test.tier = 'lite', so test ∩ paid is empty.
    //   - real_free = everything else — real signups still on the free (lite) plan
    const [totalEntRes, paidEntRes, testIdRes] = await Promise.all([
      supabase.from('enterprises').select('id', { count: 'exact', head: true }),
      supabase
        .from('enterprises')
        .select('id', { count: 'exact', head: true })
        .neq('subscription_tier', 'lite'),
      supabase
        .from('enterprises')
        .select('test_enterprise_id')
        .not('test_enterprise_id', 'is', null),
    ]);

    if (totalEntRes.error) return NextResponse.json({ error: totalEntRes.error.message }, { status: 500 });
    if (paidEntRes.error) return NextResponse.json({ error: paidEntRes.error.message }, { status: 500 });
    if (testIdRes.error) return NextResponse.json({ error: testIdRes.error.message }, { status: 500 });

    const totalEnterprises = totalEntRes.count ?? 0;
    const paidEnterprises = paidEntRes.count ?? 0;
    const testIds = (testIdRes.data ?? [])
      .map((r) => r.test_enterprise_id as string | null)
      .filter((v): v is string => !!v);
    const testEnterprises = new Set(testIds).size;

    const realFreeEnterprises = Math.max(
      0,
      totalEnterprises - paidEnterprises - testEnterprises,
    );

    // Count users
    const { count: totalUsers, error: userError } = await supabase
      .from('user_profiles')
      .select('id', { count: 'exact', head: true });

    if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });

    // Count transactions across all three tx tables (count only — NO amounts):
    //   transactions       — on-chain stablecoin transfers
    //   fiat_transactions  — bank ramps (on/off-ramp history)
    //   yield_transactions — yield protocol deposits/withdrawals
    const [stablecoinRes, fiatRes, yieldRes] = await Promise.all([
      supabase.from('transactions').select('id', { count: 'exact', head: true }),
      supabase.from('fiat_transactions').select('id', { count: 'exact', head: true }),
      supabase.from('yield_transactions').select('id', { count: 'exact', head: true }),
    ]);

    if (stablecoinRes.error) return NextResponse.json({ error: stablecoinRes.error.message }, { status: 500 });
    if (fiatRes.error) return NextResponse.json({ error: fiatRes.error.message }, { status: 500 });
    if (yieldRes.error) return NextResponse.json({ error: yieldRes.error.message }, { status: 500 });

    const totalTransactions =
      (stablecoinRes.count ?? 0) + (fiatRes.count ?? 0) + (yieldRes.count ?? 0);

    // Count frozen enterprises
    const { count: frozenEnterprises, error: frzError } = await supabase
      .from('enterprises')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'frozen');

    if (frzError) return NextResponse.json({ error: frzError.message }, { status: 500 });

    return NextResponse.json({
      data: {
        total_enterprises: totalEnterprises,
        paid_enterprises: paidEnterprises,
        real_free_enterprises: realFreeEnterprises,
        test_enterprises: testEnterprises,
        total_users: totalUsers ?? 0,
        total_transactions: totalTransactions ?? 0,
        frozen_enterprises: frozenEnterprises ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
