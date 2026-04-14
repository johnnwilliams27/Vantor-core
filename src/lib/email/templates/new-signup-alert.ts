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
<head><meta charset="utf-8"><meta name="color-scheme" content="dark"><link rel="preconnect" href="https://api.fontshare.com"><link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap"></head>
<body style="margin:0;padding:0;background:#060d1f;font-family:'Satoshi',Arial,Helvetica,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#d1d5db">
  <div style="max-width:560px;margin:40px auto;background:#0a1628;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08)">
    <div style="background:linear-gradient(135deg,#0a1628,rgba(45,212,191,0.15));padding:24px 32px;border-bottom:1px solid rgba(255,255,255,0.08)">
      <p style="margin:0;color:#2dd4bf;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600">Vantor &middot; New signup</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:20px">${esc(fullName)} just signed up</h1>
    </div>
    <div style="padding:28px 32px">
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#e5e7eb">
        <tbody>
          <tr>
            <td style="padding:8px 0;color:#6b7280;width:120px">Name</td>
            <td style="padding:8px 0;font-weight:500">${esc(fullName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Email</td>
            <td style="padding:8px 0;font-weight:500">
              <a href="mailto:${esc(email)}" style="color:#2dd4bf;text-decoration:none">${esc(email)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Company</td>
            <td style="padding:8px 0;font-weight:500">${esc(companyName)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Enterprise ID</td>
            <td style="padding:8px 0;font-family:ui-monospace,Menlo,Monaco,monospace;font-size:12px;color:#9ca3af">${esc(enterpriseId)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Signed up</td>
            <td style="padding:8px 0">${esc(when)} ET</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#6b7280">Source</td>
            <td style="padding:8px 0">${viaInvite ? 'Invitation link' : 'Direct signup'}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:24px 0 0;padding:12px 14px;background:rgba(45,212,191,0.08);border-left:3px solid #2dd4bf;color:#d1d5db;font-size:13px;line-height:1.5;border-radius:0 6px 6px 0">
        The user still needs to verify their email before they can sign in. They&rsquo;ll receive the verification link separately.
      </p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(255,255,255,0.08);text-align:center">
      <p style="color:#6b7280;font-size:11px;margin:0">Automated alert from Vantor &middot; ${esc(when)} ET</p>
    </div>
  </div>
</body>
</html>`;
}
