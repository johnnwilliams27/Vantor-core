import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { seedTestEnterprise } from '@/lib/test-mode/helpers';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  fullName: z.string().min(2).max(100),
  companyName: z.string().min(1).max(200),
  inviteToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
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
      return NextResponse.json({ error: authError.message }, { status: authError.status ?? 400 });
    }

    const userId = authData.user.id;

    // Create enterprise
    const { data: enterprise, error: entError } = await supabase
      .from('enterprises')
      .insert({ name: companyName, status: 'active', subscription_tier: 'lite' })
      .select('id')
      .single();

    if (entError) throw entError;

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

    // Update user profile
    await supabase
      .from('user_profiles')
      .update({
        full_name: fullName,
        enterprise_id: enterprise.id,
        role: 'treasury_manager',
      })
      .eq('id', userId);

    // Seed test data
    if (testEnterprise) {
      await seedTestEnterprise(testEnterprise.id, enterprise.id, supabase);
    }

    return NextResponse.json({ message: 'Account created' }, { status: 201 });
  } catch (err) {
    console.error('[register]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
