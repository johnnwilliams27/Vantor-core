import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const erpConfigId = searchParams.get('erpConfigId');

  const supabase = createAdminClient();

  let query = supabase
    .from('erp_vendors')
    .select('*, erp_configuration:erp_configurations!inner(user_id)')
    .eq('erp_configuration.user_id', session.user.id)
    .order('name');

  if (erpConfigId) query = query.eq('erp_config_id', erpConfigId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
