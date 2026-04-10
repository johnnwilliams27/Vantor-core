import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { seedTestEnterprise } from '@/lib/test-mode/helpers';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/api/rate-limit';
import { sendEmail, sendNotificationEmail } from '@/lib/email/send';
import { verifyEmailHtml } from '@/lib/email/templates/verify-email';
import { newSignupAlertHtml } from '@/lib/email/templates/new-signup-alert';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  fullName: z.string().min(2).max(100),
  companyName: z.string().min(1).max(200),
  inviteToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit('register', ip, 5, 3600_000)) {
    return rateLimitResponse();
  }

  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { email, password, fullName, companyName, inviteToken } = parsed.data;
    const supabase = createAdminClient();

    // Validate invite token if provided
    if (inviteToken) {
      const { data: invitation } = await supabase
        .from('invitations')
        .select('*')
        .eq('token', inviteToken)
        .eq('status', 'pending')
        .single();

      if (!invitation || new Date(invitation.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 });
      }

      await supabase.from('invitations').update({ status: 'accepted' }).eq('id', invitation.id);
    }

    // Create auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      process.stdout.write('[register] auth error: ' + authError.message + '\n');
      return NextResponse.json({ error: authError.message }, { status: authError.status ?? 400 });
    }

    const userId = authData.user.id;
    process.stdout.write('[register] user created: ' + userId + '\n');

    // Create enterprise
    const { data: enterprise, error: entError } = await supabase
      .from('enterprises')
      .insert({ name: companyName, status: 'active', subscription_tier: 'lite' })
      .select('id')
      .single();

    if (entError) {
      process.stdout.write('[register] enterprise error: ' + JSON.stringify(entError) + '\n');
      throw entError;
    }
    process.stdout.write('[register] enterprise created: ' + enterprise.id + '\n');

    // Create test enterprise
    const { data: testEnterprise } = await supabase
      .from('enterprises')
      .insert({
        name: `${companyName} (Test)`,
        status: 'active',
        subscription_tier: 'lite',
        is_test_enterprise: true,
        metadata: { source_enterprise_id: enterprise.id },
      })
      .select('id')
      .single();

    // Link test enterprise
    if (testEnterprise) {
      await supabase
        .from('enterprises')
        .update({ test_enterprise_id: testEnterprise.id })
        .eq('id', enterprise.id);
    }

    // Create subscription record (Lite — no Stripe IDs)
    await supabase.from('subscriptions').insert({
      enterprise_id: enterprise.id,
      tier: 'lite',
      status: 'active',
    });

    // Generate email verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Update user profile
    await supabase
      .from('user_profiles')
      .update({
        full_name: fullName,
        enterprise_id: enterprise.id,
        role: 'treasury_manager',
        email_verified: false,
        email_verification_token: verificationToken,
        email_verification_expires_at: verificationExpires.toISOString(),
      })
      .eq('id', userId);

    // Seed test data
    if (testEnterprise) {
      await seedTestEnterprise(testEnterprise.id, enterprise.id, supabase);
    }

    // Send verification email
    const verifyUrl = `${process.env.NEXTAUTH_URL}/api/auth/verify-email?token=${verificationToken}`;
    await sendEmail({
      to: email,
      subject: 'Verify your email — Vantor',
      html: verifyEmailHtml({ fullName, verifyUrl }),
    });

    // Internal notification to the founder — never block signup if this fails.
    sendNotificationEmail({
      to: 'john@vantor.xyz',
      subject: `New Vantor signup: ${fullName} (${companyName})`,
      html: newSignupAlertHtml({
        fullName,
        email,
        companyName,
        enterpriseId: enterprise.id,
        viaInvite: !!inviteToken,
      }),
    }).catch((err) => {
      process.stdout.write('[register] signup alert failed: ' + (err?.message ?? String(err)) + '\n');
    });

    return NextResponse.json({ message: 'Account created. Please check your email to verify your account.' }, { status: 201 });
  } catch (err: any) {
    process.stdout.write('[register] ERROR: ' + JSON.stringify({ message: err?.message, code: err?.code, details: err?.details, hint: err?.hint }) + '\n');
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
