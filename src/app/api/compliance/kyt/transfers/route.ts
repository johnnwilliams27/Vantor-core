import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const supabase = createAdminClient();
  const { searchParams } = new URL(req.url);
  const minRisk = searchParams.get('min_risk');

  let q = supabase
    .from('kyt_transfers')
    .select('*')
    .eq('user_id', session.user.id)
    .order('registered_at', { ascending: false })
    .limit(100);

  if (minRisk) {
    q = q.gte('risk_score', Number(minRisk));
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
