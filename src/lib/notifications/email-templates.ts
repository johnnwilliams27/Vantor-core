const BRAND_COLOR = '#19595b';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.vantor.xyz';

export function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:${BRAND_COLOR};padding:28px 32px;text-align:center">
      <img src="https://vantor.xyz/logo-dark.png" alt="Vantor" style="height:40px" />
    </div>
    ${content}
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">&copy; 2026 Vantor Treasury, Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

export function ctaButton(label: string, href: string, variant: 'primary' | 'outline' = 'primary'): string {
  const fullHref = href.startsWith('http') ? href : `${APP_URL}${href}`;
  if (variant === 'outline') {
    return `<a href="${fullHref}" style="display:inline-block;padding:12px 24px;border:2px solid ${BRAND_COLOR};color:${BRAND_COLOR};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${label}</a>`;
  }
  return `<a href="${fullHref}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${label}</a>`;
}

export function fmtUsd(v: string | number | null): string {
  if (v === null || v === undefined) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v));
}

export function actionNotificationEmail(params: {
  title: string;
  details: { label: string; value: string }[];
  ctaLabel: string;
  ctaHref: string;
  scheduledDeviation?: { toleranceBps: number; actualBps: number };
}): string {
  const detailRows = params.details
    .map((d) => `
      <tr>
        <td style="padding:6px 12px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0">${d.label}</td>
        <td style="padding:6px 12px;font-size:13px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0;text-align:right">${d.value}</td>
      </tr>`)
    .join('');

  const deviationHtml = params.scheduledDeviation
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b33;border-radius:8px;padding:12px;margin-top:16px;font-size:13px;color:#92400e">
        Rate deviation: ${params.scheduledDeviation.actualBps}bps (tolerance: ${params.scheduledDeviation.toleranceBps}bps)
      </div>`
    : '';

  return emailLayout(`
    <div style="padding:32px">
      <h1 style="font-size:20px;color:#111;margin:0 0 20px">${params.title}</h1>
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;overflow:hidden">
        ${detailRows}
      </table>
      ${deviationHtml}
      <div style="text-align:center;margin-top:24px">
        ${ctaButton(params.ctaLabel, params.ctaHref)}
      </div>
    </div>`);
}

export function alertEmail(params: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  severity?: 'warning' | 'error';
}): string {
  const severityColor = params.severity === 'error' ? '#dc2626' : '#f59e0b';
  const severityBg = params.severity === 'error' ? '#fef2f2' : '#fffbeb';

  return emailLayout(`
    <div style="padding:32px">
      <div style="background:${severityBg};border-left:4px solid ${severityColor};border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
        <h1 style="font-size:18px;color:#111;margin:0 0 8px">${params.title}</h1>
        <p style="color:#666;font-size:14px;margin:0;line-height:1.5">${params.description}</p>
      </div>
      <div style="text-align:center">
        ${ctaButton(params.ctaLabel, params.ctaHref)}
      </div>
    </div>`);
}

export function infoEmail(params: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}): string {
  return emailLayout(`
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:20px;color:#111;margin:0 0 12px">${params.title}</h1>
      <p style="color:#666;font-size:14px;margin:0 0 24px;line-height:1.5">${params.description}</p>
      ${ctaButton(params.ctaLabel, params.ctaHref)}
    </div>`);
}

export { APP_URL };
