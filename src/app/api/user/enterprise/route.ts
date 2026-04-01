import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { isTestMode, getEffectiveEnterpriseId } from '@/lib/test-mode/helpers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json({ name: null });
  }

  const supabase = createAdminClient();
  const effectiveEnterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const { data } = await supabase
    .from('enterprises')
    .select('name, is_test_enterprise')
    .eq('id', effectiveEnterpriseId)
    .single();

  // In Lite test mode, return demo team members
  const inTestMode = isTestMode();
  const isLite = session.user.subscription_tier === 'lite';
  if (inTestMode && isLite && data?.is_test_enterprise) {
    return NextResponse.json({
      name: data.name?.replace(' [TEST]', '') ?? null,
      team: DEMO_TEAM,
    });
  }

  // Fetch real team members with KYC status
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

  return NextResponse.json({ name: data?.name?.replace(' [TEST]', '') ?? null, team });
}

const DEMO_TEAM = [
  { id: 'demo-1', name: 'Sarah Chen',      email: 'sarah.chen@company.io',  role: 'treasury_manager', kycStatus: 'completed' },
  { id: 'demo-2', name: 'Jordan Lee',      email: 'jordan.lee@company.io',  role: 'treasury_manager', kycStatus: 'completed' },
  { id: 'demo-3', name: 'Marcus Johnson',  email: 'marcus.j@company.io',    role: 'accountant',       kycStatus: 'completed' },
  { id: 'demo-4', name: 'Emily Rodriguez', email: 'emily.r@company.io',     role: 'accountant',       kycStatus: 'pending'   },
  { id: 'demo-5', name: 'David Kim',       email: 'david.kim@company.io',   role: 'auditor',          kycStatus: 'not_started' },
  { id: 'demo-6', name: 'Alex Thompson',   email: 'alex.t@company.io',      role: 'auditor',          kycStatus: 'completed' },
];
