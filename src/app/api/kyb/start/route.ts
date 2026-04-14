import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasRole } from '@/lib/auth/rbac';
import type { UserRole } from '@/types/database';

const PERSONA_API_KEY = process.env.PERSONA_API_KEY!;
const PERSONA_KYB_TEMPLATE_ID = process.env.PERSONA_KYB_TEMPLATE_ID!;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || !hasRole(session.user.role as UserRole, 'treasury_manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Check if KYB already completed
  const { data: existing } = await supabase
    .from('kyb_verifications')
    .select('status, persona_inquiry_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (existing?.status === 'completed') {
    return NextResponse.json({ status: 'already_completed' });
  }

  // Create Persona KYB inquiry
  const response = await fetch('https://withpersona.com/api/v1/inquiries', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERSONA_API_KEY}`,
      'Content-Type': 'application/json',
      'Persona-Version': '2023-01-05',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          'inquiry-template-id': PERSONA_KYB_TEMPLATE_ID,
          'reference-id': session.user.enterprise_id,
          ...(process.env.PERSONA_ENVIRONMENT_ID ? { 'environment-id': process.env.PERSONA_ENVIRONMENT_ID } : {}),
        },
      },
    }),
  });

  const result = await response.json();
  const inquiryId = result.data?.id;

  if (!inquiryId) {
    return NextResponse.json({ error: 'Failed to create KYB inquiry' }, { status: 502 });
  }

  // Upsert KYB verification
  if (existing) {
    await supabase
      .from('kyb_verifications')
      .update({ persona_inquiry_id: inquiryId, status: 'pending' })
      .eq('enterprise_id', session.user.enterprise_id);
  } else {
    await supabase.from('kyb_verifications').insert({
      enterprise_id: session.user.enterprise_id,
      persona_inquiry_id: inquiryId,
      status: 'pending',
    });
  }

  return NextResponse.json({
    inquiryId,
    sessionToken: result.data?.attributes?.['session-token'],
  });
}
