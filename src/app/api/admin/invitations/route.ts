import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { invitationEmailHtml } from '@/lib/email/templates/invitation';
import crypto from 'crypto';

// POST — send invitation
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_app_admin) {
    return NextResponse.json({ error: 'App admin required' }, { status: 403 });
  }

  const { email } = await req.json();
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Check if already invited (pending)
  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
    .single();

  if (existing) {
    return NextResponse.json(
      { error: 'Invitation already pending for this email' },
      { status: 409 }
    );
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await supabase.from('invitations').insert({
    email: email.toLowerCase(),
    invited_by: session.user.id,
    inviter_email: session.user.email,
    token,
    status: 'pending',
    expires_at: expiresAt.toISOString(),
  });

  const signupUrl = `${process.env.NEXTAUTH_URL}/register?invite=${token}&email=${encodeURIComponent(email)}`;

  await sendEmail({
    to: email,
    subject: "You're invited to join Vantor",
    html: invitationEmailHtml({
      inviterName: session.user.name || 'A Vantor admin',
      signupUrl,
    }),
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

// GET — list invitations
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_app_admin) {
    return NextResponse.json({ error: 'App admin required' }, { status: 403 });
  }

  const supabase = createAdminClient();

  const { data: invitations } = await supabase
    .from('invitations')
    .select('id, email, status, expires_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ invitations: invitations || [] });
}
