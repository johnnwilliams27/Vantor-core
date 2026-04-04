import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const body = await req.json();

  const { event_type, in_app_enabled, email_enabled, slack_enabled } = body;

  if (!event_type) {
    return NextResponse.json({ error: 'event_type is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        event_type,
        in_app_enabled: in_app_enabled ?? true,
        email_enabled: email_enabled ?? true,
        slack_enabled: slack_enabled ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,event_type' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
