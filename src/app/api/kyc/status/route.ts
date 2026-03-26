import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  const { data: kyc } = await supabase
    .from('kyc_verifications')
    .select('status, completed_at, created_at')
    .eq('user_id', session.user.id)
    .single();

  return NextResponse.json({
    status: kyc?.status || 'none',
    completedAt: kyc?.completed_at,
  });
}
