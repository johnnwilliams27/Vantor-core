import { Resend } from 'resend';

let _resend: Resend;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}
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

  const result = await getResend().emails.send({
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
