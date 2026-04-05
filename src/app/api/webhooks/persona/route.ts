import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import crypto from 'crypto';

const PERSONA_WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET!;

function verifyPersonaSignature(body: string, signature: string): boolean {
  // Persona signature format: "t=<timestamp>,v1=<hash>"
  // hash = HMAC-SHA256(timestamp + "." + body)
  // NOTE: Verify against Persona's current docs before shipping to production.
  const parts = signature.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  const v1Part = parts.find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const timestamp = tPart.substring(2);
  const hash = v1Part.substring(3);

  const hmac = crypto.createHmac('sha256', PERSONA_WEBHOOK_SECRET);
  hmac.update(timestamp + '.' + body);
  const expected = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('persona-signature') || '';

  if (!verifyPersonaSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();
  const event = JSON.parse(body);
  const eventId = event.data?.id || event.id;

  // Idempotency check
  const { data: existing } = await supabaseAdmin
    .from('webhook_events')
    .select('id')
    .eq('event_id', eventId)
    .single();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  await supabaseAdmin.from('webhook_events').insert({
    source: 'persona',
    event_id: eventId,
    event_type: event.data?.attributes?.event_type || 'unknown',
  });

  const eventType = event.data?.attributes?.event_type;
  const inquiry = event.data?.attributes?.payload?.data;

  try {
    if (eventType === 'inquiry.completed' || eventType === 'inquiry.approved') {
      await handleInquiryCompleted(inquiry);
    } else if (eventType === 'inquiry.failed' || eventType === 'inquiry.declined') {
      await handleInquiryFailed(inquiry);
    } else if (eventType === 'inquiry.expired') {
      await handleInquiryExpired(inquiry);
    }
  } catch (err) {
    console.error(`Error handling Persona event ${eventType}:`, err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleInquiryCompleted(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;
  const supabaseAdmin = createAdminClient();

  // Check KYC first
  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('id')
    .eq('persona_inquiry_id', inquiryId)
    .single();

  if (kyc) {
    await supabaseAdmin
      .from('kyc_verifications')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', kyc.id);
    return;
  }

  // Check KYB
  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('id, enterprise_id')
    .eq('persona_inquiry_id', inquiryId)
    .single();

  if (kyb) {
    await supabaseAdmin
      .from('kyb_verifications')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', kyb.id);

    // Extract country from Persona inquiry attributes
    // Persona KYB inquiries include address fields on the inquiry object
    const country =
      inquiry?.attributes?.fields?.address_country_code?.value  // Persona v2 format
      ?? inquiry?.attributes?.['country-code']                   // alternate field
      ?? null;

    if (country && kyb.enterprise_id) {
      await supabaseAdmin
        .from('enterprises')
        .update({ country: country.toUpperCase() })
        .eq('id', kyb.enterprise_id);
    }
  }
}

async function handleInquiryFailed(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;
  const supabaseAdmin = createAdminClient();

  await supabaseAdmin
    .from('kyc_verifications')
    .update({ status: 'failed' })
    .eq('persona_inquiry_id', inquiryId);

  await supabaseAdmin
    .from('kyb_verifications')
    .update({ status: 'failed' })
    .eq('persona_inquiry_id', inquiryId);
}

async function handleInquiryExpired(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;
  const supabaseAdmin = createAdminClient();

  await supabaseAdmin
    .from('kyc_verifications')
    .update({ status: 'expired' })
    .eq('persona_inquiry_id', inquiryId);

  await supabaseAdmin
    .from('kyb_verifications')
    .update({ status: 'expired' })
    .eq('persona_inquiry_id', inquiryId);
}
