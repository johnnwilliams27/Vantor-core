import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { verifyEmailHtml } from '@/lib/email/templates/verify-email';
import crypto from 'crypto';

/**
 * POST /api/auth/resend-verification
 * Body: { email: string }
 *
 * Regenerates the email_verification_token + expiry for the given email (if it
 * exists and is not already verified) and re-sends the verification email.
 *
 * Returns { ok: true } unconditionally to avoid leaking whether an email is
 * registered. Rate-limit guardrail: the prior token must be at least 60 seconds
 * old before we send a new one.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, email, email_verified, email_verification_expires_at')
    .eq('email', email)
    .single();

  // Always return ok to avoid leaking account existence.
  if (!profile) return NextResponse.json({ ok: true });
  if (profile.email_verified) return NextResponse.json({ ok: true });

  // Rate-limit: if an existing token was issued <60s ago (expires_at > now + 23h59m),
  // skip — prevents mail flooding from repeated button clicks.
  if (profile.email_verification_expires_at) {
    const issuedAt = new Date(profile.email_verification_expires_at).getTime() - 24 * 3600 * 1000;
    if (Date.now() - issuedAt < 60_000) {
      return NextResponse.json({ ok: true, rateLimited: true });
    }
  }

  // Generate fresh token + 24h expiry
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await supabase
    .from('user_profiles')
    .update({
      email_verification_token: verificationToken,
      email_verification_expires_at: verificationExpires.toISOString(),
    })
    .eq('id', profile.id);

  const verifyUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${verificationToken}`;
  await sendEmail({
    to: profile.email,
    subject: 'Verify your email — Vantor',
    html: verifyEmailHtml({
      fullName: profile.full_name ?? 'there',
      verifyUrl,
    }),
  });

  return NextResponse.json({ ok: true });
}
