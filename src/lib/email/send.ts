import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const USE_MOCK = process.env.RESEND_USE_MOCK === 'true';

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}) {
  if (USE_MOCK) {
    console.log('[MOCK EMAIL]', { to: params.to, subject: params.subject });
    return { id: 'mock-' + Date.now() };
  }

  const result = await resend.emails.send({
    from: 'Vantor <billing@vantor.xyz>',
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments?.map(a => ({
      filename: a.filename,
      content: a.content,
    })),
  });

  return result;
}
