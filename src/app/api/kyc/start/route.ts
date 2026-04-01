import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

const PERSONA_API_KEY = process.env.PERSONA_API_KEY!;
const PERSONA_KYC_TEMPLATE_ID = process.env.PERSONA_KYC_TEMPLATE_ID!;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Check if KYC already completed
  const { data: existing } = await supabase
    .from('kyc_verifications')
    .select('status, persona_inquiry_id')
    .eq('user_id', session.user.id)
    .single();

  if (existing?.status === 'completed') {
    return NextResponse.json({ status: 'already_completed' });
  }

  // Create Persona inquiry
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
          'inquiry-template-id': PERSONA_KYC_TEMPLATE_ID,
          'reference-id': session.user.id,
          ...(process.env.PERSONA_ENVIRONMENT_ID ? { 'environment-id': process.env.PERSONA_ENVIRONMENT_ID } : {}),
        },
      },
    }),
  });

  const result = await response.json();
  const inquiryId = result.data?.id;

  if (!inquiryId) {
    return NextResponse.json({ error: 'Failed to create inquiry' }, { status: 502 });
  }

  // Upsert KYC verification record
  if (existing) {
    await supabase
      .from('kyc_verifications')
      .update({ persona_inquiry_id: inquiryId, status: 'pending' })
      .eq('user_id', session.user.id);
  } else {
    await supabase.from('kyc_verifications').insert({
      enterprise_id: session.user.enterprise_id,
      user_id: session.user.id,
      persona_inquiry_id: inquiryId,
      status: 'pending',
    });
  }

  return NextResponse.json({
    inquiryId,
    sessionToken: result.data?.attributes?.['session-token'],
  });
}
