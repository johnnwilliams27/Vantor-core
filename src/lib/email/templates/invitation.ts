import { emailLayout, ctaButton } from '@/lib/notifications/email-templates';

export function invitationEmailHtml(params: {
  inviterName: string;
  signupUrl: string;
}): string {
  return emailLayout(`
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:22px;color:#fff;margin:0 0 12px">You&rsquo;re Invited to Vantor</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 28px;line-height:1.5">
        ${params.inviterName} has invited you to join Vantor, the stablecoin treasury management platform.
      </p>
      ${ctaButton('Sign Up for Vantor', params.signupUrl)}
      <p style="color:#6b7280;font-size:12px;margin:24px 0 0">
        This invitation expires in 7 days.
      </p>
    </div>`);
}
