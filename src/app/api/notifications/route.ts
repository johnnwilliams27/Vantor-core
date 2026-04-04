import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10);

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('read', false);

  return NextResponse.json({ data, unreadCount: count ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const body = await req.json();

  if (body.ids && Array.isArray(body.ids)) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .in('id', body.ids);
  } else {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .eq('read', false);
  }

  return NextResponse.json({ success: true });
}
