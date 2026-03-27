import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/verify-email?status=invalid', req.url));
  }

  const supabase = createAdminClient();

  // Find user by verification token
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, email_verified, email_verification_expires_at')
    .eq('email_verification_token', token)
    .single();

  if (!profile) {
    return NextResponse.redirect(new URL('/verify-email?status=invalid', req.url));
  }

  if (profile.email_verified) {
    return NextResponse.redirect(new URL('/verify-email?status=already', req.url));
  }

  if (profile.email_verification_expires_at && new Date(profile.email_verification_expires_at) < new Date()) {
    return NextResponse.redirect(new URL('/verify-email?status=expired', req.url));
  }

  // Mark as verified
  await supabase
    .from('user_profiles')
    .update({
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    })
    .eq('id', profile.id);

  return NextResponse.redirect(new URL('/verify-email?status=success', req.url));
}
