import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/api/rate-limit';

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit('contact-ip', ip, 5, 60 * 1000)) {
    return rateLimitResponse();
  }

  try {
    const { name, email, company, message } = await req.json();

    if (!name || !email || !message) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (typeof name !== 'string' || name.length > 200) {
      return NextResponse.json({ error: 'Name too long (max 200 chars)' }, { status: 400 });
    }
    if (typeof email !== 'string' || email.length > 320) {
      return NextResponse.json({ error: 'Email too long' }, { status: 400 });
    }
    if (typeof message !== 'string' || message.length > 5000) {
      return NextResponse.json({ error: 'Message too long (max 5000 chars)' }, { status: 400 });
    }
    if (company && (typeof company !== 'string' || company.length > 200)) {
      return NextResponse.json({ error: 'Company name too long (max 200 chars)' }, { status: 400 });
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    if (!checkRateLimit('contact-email', email, 3, 60 * 60 * 1000)) {
      return rateLimitResponse();
    }

    if (process.env.RESEND_USE_MOCK === 'true') {
      console.log('[MOCK RESEND] Would send contact email:', { name, email, company, message: message.slice(0, 100) });
      return NextResponse.json({ success: true });
    }

    await getResend().emails.send({
      from: 'Vantor Contact Form <contact@vantor.xyz>',
      to: 'contact@vantor.xyz',
      replyTo: email,
      subject: `Vantor Inquiry from ${name}${company ? ` (${company})` : ''}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        company ? `Company: ${company}` : null,
        '',
        'Message:',
        message,
      ]
        .filter(Boolean)
        .join('\n'),
      html: `
        <div style="font-family: sans-serif; max-width: 600px;">
          <h2 style="color: #19595b;">New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          ${company ? `<p><strong>Company:</strong> ${escapeHtml(company)}</p>` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Contact form error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
