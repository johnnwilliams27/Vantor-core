import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = session.user.enterprise_id;
  if (!enterpriseId) return NextResponse.json({ data: [] });

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('ondo_kyc_verifications')
    .select('wallet_address, status, verified_at')
    .eq('enterprise_id', enterpriseId);

  return NextResponse.json({ data: data || [] });
}
