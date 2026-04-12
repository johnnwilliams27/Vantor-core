import { emailLayout, ctaButton } from '@/lib/notifications/email-templates';

export function verifyEmailHtml(params: {
  fullName: string;
  verifyUrl: string;
}): string {
  return emailLayout(`
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:22px;color:#fff;margin:0 0 12px">Verify Your Email</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 8px;line-height:1.5">
        Hi ${params.fullName},
      </p>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 28px;line-height:1.5">
        Thanks for signing up for Vantor. Please verify your email address to activate your account.
      </p>
      ${ctaButton('Verify Email Address', params.verifyUrl)}
      <p style="color:#6b7280;font-size:12px;margin:24px 0 0">
        This link expires in 24 hours. If you didn&rsquo;t create an account, you can ignore this email.
      </p>
    </div>`);
}
