const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.vantor.xyz';

// Email-safe palette — matches Vantor style guide Section 12 tokens.
// Hex values only (no CSS vars, no opacity notation) because email clients
// strip CSS variables and many fail on rgba() with /20-style notation.
const BG = '#060d1f';         // page/body bg — darkest
const CARD = '#0a1628';       // card surface — elevated
const BORDER = 'rgba(255,255,255,0.08)';
const TEXT_1 = '#e5e7eb';     // primary text (headings, values)
const TEXT_2 = '#d1d5db';     // body text
const TEXT_3 = '#9ca3af';     // secondary/labels
const TEXT_4 = '#6b7280';     // tertiary/captions
const TEAL = '#2dd4bf';       // brand accent (teal-400)
const CYAN = '#67e8f9';       // gradient end (cyan-300)
const L1 = '#1A7F71';         // Tier 2 primary (L1) — solid product CTAs

// Arial-led font stack. Arial is the most reliable cross-client font
// (Outlook, Apple Mail, Gmail all render it correctly). System fonts
// listed as fallbacks for clients that support them (Apple Mail, Gmail
// web), but Outlook/corporate clients reliably render Arial only.
const FONT = "Arial, Helvetica, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:${BG};font-family:${FONT};color:${TEXT_2}">
  <div style="max-width:560px;margin:40px auto;background:${CARD};border-radius:12px;overflow:hidden;border:1px solid ${BORDER}">
    <div style="padding:28px 32px;text-align:center;border-bottom:1px solid ${BORDER}">
      <img src="https://vantor.xyz/logo-dark.png" alt="Vantor" style="height:40px" />
    </div>
    ${content}
    <div style="padding:16px 32px;border-top:1px solid ${BORDER};text-align:center">
      <p style="color:${TEXT_4};font-size:11px;margin:0">&copy; 2026 Vantor Treasury, Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Email CTA button. Three variants per style guide:
 *   'brand'   — gradient pill (marketing/invitation — brand-forward)
 *   'primary' — solid L1 teal (auth/access/account — product access signal)
 *   'outline' — secondary action
 *
 * Shape is rounded-lg (8px) per style guide Stage 3f decision. Inline
 * styles only (no classes) because email clients strip external CSS.
 */
export function ctaButton(
  label: string,
  href: string,
  variant: 'brand' | 'primary' | 'outline' = 'primary',
): string {
  const fullHref = href.startsWith('http') ? href : `${APP_URL}${href}`;
  const base = `display:inline-block;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;font-family:${FONT}`;
  if (variant === 'brand') {
    return `<a href="${fullHref}" style="${base};background:linear-gradient(90deg,${TEAL},${CYAN});color:${BG}">${label}</a>`;
  }
  if (variant === 'outline') {
    return `<a href="${fullHref}" style="${base};border:1px solid rgba(45,212,191,0.5);color:${TEAL}">${label}</a>`;
  }
  // primary — solid L1 teal, white text
  return `<a href="${fullHref}" style="${base};background:${L1};color:#ffffff">${label}</a>`;
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
        <td style="padding:8px 14px;color:${TEXT_3};font-size:13px;border-bottom:1px solid ${BORDER}">${d.label}</td>
        <td style="padding:8px 14px;font-size:13px;font-weight:600;color:${TEXT_1};border-bottom:1px solid ${BORDER};text-align:right">${d.value}</td>
      </tr>`)
    .join('');

  const deviationHtml = params.scheduledDeviation
    ? `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px;margin-top:16px;font-size:13px;color:#fbbf24">
        Rate deviation: ${params.scheduledDeviation.actualBps}bps (tolerance: ${params.scheduledDeviation.toleranceBps}bps)
      </div>`
    : '';

  return emailLayout(`
    <div style="padding:32px">
      <h1 style="font-size:20px;color:#fff;margin:0 0 20px">${params.title}</h1>
      <table style="width:100%;border-collapse:collapse;background:rgba(255,255,255,0.03);border-radius:8px;overflow:hidden;border:1px solid ${BORDER}">
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
  const severityColor = params.severity === 'error' ? '#f87171' : '#fbbf24';
  const severityBg = params.severity === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)';
  const severityBorder = params.severity === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';

  return emailLayout(`
    <div style="padding:32px">
      <div style="background:${severityBg};border-left:4px solid ${severityColor};border:1px solid ${severityBorder};border-left-width:4px;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
        <h1 style="font-size:18px;color:#fff;margin:0 0 8px">${params.title}</h1>
        <p style="color:${TEXT_2};font-size:14px;margin:0;line-height:1.5">${params.description}</p>
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
      <h1 style="font-size:20px;color:#fff;margin:0 0 12px">${params.title}</h1>
      <p style="color:${TEXT_3};font-size:14px;margin:0 0 24px;line-height:1.5">${params.description}</p>
      ${ctaButton(params.ctaLabel, params.ctaHref)}
    </div>`);
}

export { APP_URL };
