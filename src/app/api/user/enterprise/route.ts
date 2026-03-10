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

  return NextResponse.json({ name: data?.name ?? null });
}
