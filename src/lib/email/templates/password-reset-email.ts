import { emailLayout, ctaButton } from '@/lib/notifications/email-templates';

export function passwordResetHtml(params: {
  fullName: string;
  resetUrl: string;
}): string {
  const displayName = params.fullName?.trim() || 'there';
  return emailLayout(`
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:22px;color:#fff;margin:0 0 12px">Reset Your Password</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 8px;line-height:1.5">
        Hi ${displayName},
      </p>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 28px;line-height:1.5">
        We received a request to reset the password for your Vantor account.
        Click the button below to choose a new password.
      </p>
      ${ctaButton('Reset Password', params.resetUrl)}
      <p style="color:#6b7280;font-size:12px;margin:24px 0 8px">
        This link expires in 1 hour and can only be used once.
      </p>
      <p style="color:#6b7280;font-size:12px;margin:0">
        If you didn&rsquo;t request a password reset, you can safely ignore this email &mdash; your password will not change.
      </p>
    </div>`);
}
