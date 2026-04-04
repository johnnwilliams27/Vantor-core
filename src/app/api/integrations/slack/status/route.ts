import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ connected: false });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('slack_integrations')
    .select('id')
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  return NextResponse.json({ connected: !!data });
}
