import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabase = createAdminClient();

  const { data: kyb } = await supabase
    .from('kyb_verifications')
    .select('status, legal_entity_name, completed_at, created_at')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  return NextResponse.json({
    status: kyb?.status || 'none',
    legalEntityName: kyb?.legal_entity_name,
    completedAt: kyb?.completed_at,
  });
}
