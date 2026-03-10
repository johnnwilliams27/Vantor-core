import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();
  const userId = session.user.id;
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Screenings in last 24h
    const { count: totalScreenings } = await supabase
      .from('sanctions_screenings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('screened_at', twentyFourHoursAgo);

    const { count: sanctionedHits } = await supabase
      .from('sanctions_screenings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('result', 'sanctioned')
      .gte('screened_at', twentyFourHoursAgo);

    // Open KYT alerts by severity
    const { data: openAlerts } = await supabase
      .from('kyt_alerts')
      .select('severity')
      .eq('user_id', userId)
      .eq('status', 'open');

    const alertsBySeverity = { low: 0, medium: 0, high: 0, severe: 0 };
    for (const a of openAlerts ?? []) {
      if (a.severity in alertsBySeverity) {
        alertsBySeverity[a.severity as keyof typeof alertsBySeverity]++;
      }
    }

    // Pending travel rule transfers
    const { count: pendingTravelRule } = await supabase
      .from('travel_rule_transfers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'pending');

    // Recent high-risk KYT transfers
    const { data: highRiskTransfers } = await supabase
      .from('kyt_transfers')
      .select('id, external_id, chain, direction, amount, asset_amount_usd, risk_score, registered_at')
      .eq('user_id', userId)
      .gte('risk_score', 50)
      .order('registered_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      data: {
        screenings24h: totalScreenings ?? 0,
        sanctionedHits24h: sanctionedHits ?? 0,
        openAlerts: alertsBySeverity,
        totalOpenAlerts: (openAlerts ?? []).length,
        pendingTravelRule: pendingTravelRule ?? 0,
        highRiskTransfers: highRiskTransfers ?? [],
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
