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
  const status = searchParams.get('status');
  const severity = searchParams.get('severity');

  let q = supabase
    .from('kyt_alerts')
    .select('*, kyt_transfer:kyt_transfers(*)')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', session.user.enterprise_id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (status) q = q.eq('status', status);
  if (severity) q = q.eq('severity', severity);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
