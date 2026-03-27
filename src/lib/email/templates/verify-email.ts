export function verifyEmailHtml(params: {
  fullName: string;
  verifyUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:#19595b;padding:28px 32px;text-align:center">
      <img src="https://vantor.xyz/logo-dark.png" alt="Vantor" style="height:40px" />
    </div>
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:22px;color:#111;margin:0 0 12px">Verify Your Email</h1>
      <p style="color:#666;font-size:14px;margin:0 0 8px;line-height:1.5">
        Hi ${params.fullName},
      </p>
      <p style="color:#666;font-size:14px;margin:0 0 28px;line-height:1.5">
        Thanks for signing up for Vantor. Please verify your email address to activate your account.
      </p>
      <a href="${params.verifyUrl}" style="display:inline-block;padding:14px 32px;background:#19595b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
        Verify Email Address
      </a>
      <p style="color:#999;font-size:12px;margin:24px 0 0">
        This link expires in 24 hours. If you didn&rsquo;t create an account, you can ignore this email.
      </p>
    </div>
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">&copy; 2026 Vantor Treasury, Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}
