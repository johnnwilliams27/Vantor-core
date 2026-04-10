import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/api/rate-limit';
import { sendEmail } from '@/lib/email/send';
import { passwordResetHtml } from '@/lib/email/templates/password-reset-email';

const schema = z.object({
  email: z.string().email().max(254),
});

// Generic response returned in every code path to prevent user enumeration.
const GENERIC_RESPONSE = {
  message: "If an account exists for that email, we've sent a password reset link.",
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // 5 requests / hour per IP — prevents mass enumeration and email-bombing.
  if (!checkRateLimit('forgot-password-ip', ip, 5, 3600_000)) {
    return rateLimitResponse();
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // Still return generic success — don't leak that the input was bad.
      return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
    }

    const email = parsed.data.email.trim().toLowerCase();

    // Per-email rate limit: 3 / hour. Stops someone spamming one inbox.
    if (!checkRateLimit('forgot-password-email', email, 3, 3600_000)) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
    }

    const supabase = createAdminClient();

    // Look up the user via Supabase Auth admin API.
    const { data: authList } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const authUser = authList?.users?.find(
      (u) => u.email?.toLowerCase() === email
    );

    if (!authUser) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
    }

    // Fetch profile to get full_name and verify the account is usable.
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, full_name, email_verified')
      .eq('id', authUser.id)
      .single();

    // Require a verified email before allowing a reset — otherwise the reset
    // link could be used to take over an unverified account that the real
    // owner hasn't activated yet.
    if (!profile || !profile.email_verified) {
      return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
    }

    // Generate single-use token, 1 hour expiry.
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        password_reset_token: token,
        password_reset_expires_at: expiresAt.toISOString(),
      })
      .eq('id', authUser.id);

    if (updateError) {
      process.stdout.write('[forgot-password] update error: ' + updateError.message + '\n');
      return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
    }

    const baseUrl = process.env.NEXTAUTH_URL || 'https://www.vantor.xyz';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    await sendEmail({
      to: email,
      subject: 'Reset your Vantor password',
      html: passwordResetHtml({
        fullName: profile.full_name ?? '',
        resetUrl,
      }),
    });

    return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
  } catch (err: any) {
    process.stdout.write('[forgot-password] ERROR: ' + (err?.message ?? String(err)) + '\n');
    // Still generic — never surface internal errors to the client on this route.
    return NextResponse.json(GENERIC_RESPONSE, { status: 200 });
  }
}
