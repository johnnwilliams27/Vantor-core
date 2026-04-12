import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  const supabase = createAdminClient();
  let query = supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('is_active', true);
  if (enterpriseId) query = query.eq('enterprise_id', enterpriseId);
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST /api/bank-accounts was the manual entry endpoint. Removed because manual
// rows can't participate in balance sync or payment initiation, which makes
// them an orphan state users distrust. New connections go through
// /api/bank-accounts/stripe-fc or /api/bank-accounts/belvo instead.
