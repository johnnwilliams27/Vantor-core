import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/api/rate-limit';

// Password policy must match the register route (src/app/api/auth/register/route.ts).
const schema = z.object({
  token: z.string().min(32).max(128),
  password: z.string().min(8).max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit('reset-password', ip, 10, 3600_000)) {
    return rateLimitResponse();
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0].message },
        { status: 400 }
      );
    }

    const { token, password } = parsed.data;
    const supabase = createAdminClient();

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, password_reset_expires_at')
      .eq('password_reset_token', token)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: 'This reset link is invalid. Please request a new one.' },
        { status: 400 }
      );
    }

    if (
      !profile.password_reset_expires_at ||
      new Date(profile.password_reset_expires_at) < new Date()
    ) {
      // Clear the expired token so it can't be retried.
      await supabase
        .from('user_profiles')
        .update({
          password_reset_token: null,
          password_reset_expires_at: null,
        })
        .eq('id', profile.id);

      return NextResponse.json(
        { error: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      );
    }

    // Update the password via Supabase Auth admin API.
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      profile.id,
      { password }
    );

    if (updateError) {
      process.stdout.write('[reset-password] auth update error: ' + updateError.message + '\n');
      return NextResponse.json(
        { error: 'Failed to update password. Please try again.' },
        { status: 500 }
      );
    }

    // Single-use: clear the token after successful reset.
    await supabase
      .from('user_profiles')
      .update({
        password_reset_token: null,
        password_reset_expires_at: null,
      })
      .eq('id', profile.id);

    return NextResponse.json({
      message: 'Password updated. You can now sign in with your new password.',
    });
  } catch (err: any) {
    process.stdout.write('[reset-password] ERROR: ' + (err?.message ?? String(err)) + '\n');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
