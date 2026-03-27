import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users?.users?.find(u => u.email === email);

  if (!user) {
    // Don't reveal whether email exists
    return NextResponse.json({ verified: true });
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email_verified')
    .eq('id', user.id)
    .single();

  return NextResponse.json({ verified: profile?.email_verified ?? true });
}
