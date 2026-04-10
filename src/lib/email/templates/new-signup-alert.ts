function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function newSignupAlertHtml(params: {
  fullName: string;
  email: string;
  companyName: string;
  enterpriseId: string;
  viaInvite: boolean;
}): string {
  const { fullName, email, companyName, enterpriseId, viaInvite } = params;
  const when = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:linear-gradient(135deg,#19595b,#2dd4bf);padding:24px 32px">
      <p style="margin:0;color:rgba(255,255,255,0.75);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">Vantor &middot; New signup</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px">${esc(fullName)} just signed up</h1>
    </div>
    <div style="padding:28px 32px">
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111">
        <tbody>
          <tr>
            <td style="padding:8px 0;color:#666;width:120px">Name</td>
            <td style="padding:8px 0;font-weight:500">${esc(fullName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#666">Email</td>
            <td style="padding:8px 0;font-weight:500">
              <a href="mailto:${esc(email)}" style="color:#19595b;text-decoration:none">${esc(email)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#666">Company</td>
            <td style="padding:8px 0;font-weight:500">${esc(companyName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#666">Enterprise ID</td>
            <td style="padding:8px 0;font-family:ui-monospace,Menlo,Monaco,monospace;font-size:12px;color:#444">${esc(enterpriseId)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#666">Signed up</td>
            <td style="padding:8px 0">${esc(when)} ET</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#666">Source</td>
            <td style="padding:8px 0">${viaInvite ? 'Invitation link' : 'Direct signup'}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:24px 0 0;padding:12px 14px;background:#f0fdfa;border-left:3px solid #19595b;color:#134849;font-size:13px;line-height:1.5">
        The user still needs to verify their email before they can sign in. They&rsquo;ll receive the verification link separately.
      </p>
    </div>
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">Automated alert from Vantor &middot; ${esc(when)} ET</p>
    </div>
  </div>
</body>
</html>`;
}
