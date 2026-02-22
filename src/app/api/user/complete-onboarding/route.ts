import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(_req: NextRequest) {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch (err) {
    console.error('[complete-onboarding] getServerSession threw:', err);
    return NextResponse.json({ error: 'Auth error', detail: String(err) }, { status: 500 });
  }

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error('[complete-onboarding] createAdminClient threw:', err);
    return NextResponse.json({ error: 'DB init error', detail: String(err) }, { status: 500 });
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ onboarding_done: true })
    .eq('id', session.user.id);

  if (error) {
    console.error('[complete-onboarding] Supabase error:', error);
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  // Set a short-lived cookie the middleware can read to bypass the onboarding
  // check on the very next request (before the JWT is re-issued)
  const res = NextResponse.json({ success: true });
  res.cookies.set('onboarding_complete', '1', {
    httpOnly: true,
    maxAge: 30,  // 30 seconds — just enough for the redirect
    path: '/',
    sameSite: 'lax',
  });
  return res;
}
