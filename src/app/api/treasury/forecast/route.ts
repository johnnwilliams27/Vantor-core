import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') ?? '30', 10);
  const days = Number.isInteger(daysRaw) && daysRaw >= 7 && daysRaw <= 365 ? daysRaw : 30;

  const supabase = createAdminClient();

  try {
    const { data, error } = await supabase
      .from('treasury_forecasts')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .eq('lookahead_days', days)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
