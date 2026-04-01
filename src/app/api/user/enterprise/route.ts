import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json({ name: null });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('enterprises')
    .select('name')
    .eq('id', session.user.enterprise_id)
    .single();

  // Fetch team members with KYC status
  const { data: members } = await supabase
    .from('user_profiles')
    .select('id, email, full_name, role, created_at')
    .eq('enterprise_id', session.user.enterprise_id)
    .order('created_at', { ascending: true });

  // Get KYC status for each member
  const memberIds = members?.map(m => m.id) || [];
  const { data: kycRecords } = await supabase
    .from('kyc_verifications')
    .select('user_id, status')
    .in('user_id', memberIds.length ? memberIds : ['none']);

  const kycMap = new Map((kycRecords || []).map(k => [k.user_id, k.status]));

  const team = (members || []).map(m => ({
    id: m.id,
    name: m.full_name || m.email,
    email: m.email,
    role: m.role,
    kycStatus: kycMap.get(m.id) || 'not_started',
    createdAt: m.created_at,
  }));

  return NextResponse.json({ name: data?.name ?? null, team });
}
