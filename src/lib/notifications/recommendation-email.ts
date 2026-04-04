import { emailLayout, ctaButton, fmtUsd } from './email-templates';

const ACTION_LABELS: Record<string, string> = { onramp: 'On-Ramp', offramp: 'Off-Ramp', no_action: 'No Action Needed' };
const ACTION_COLORS: Record<string, string> = { onramp: '#16a34a', offramp: '#2563eb', no_action: '#6b7280' };

interface RecommendationEmailParams {
  id: string;
  action: string;
  recommendedAmountUsd: string | number | null;
  totalBankBalanceUsd: string | number;
  obligationsInWindowUsd: string | number;
  safetyBufferTargetUsd: string | number;
  obligationLookaheadDays: number;
  aiReasoning: string;
  stablecoinToken: string | null;
  stablecoinChain: string | null;
  bankLabel: string;
  walletLabel: string;
  status: string;
  expiresAt?: string;
}

export function recommendationEmailHtml(params: RecommendationEmailParams): string {
  const actionLabel = ACTION_LABELS[params.action] ?? params.action;
  const actionColor = ACTION_COLORS[params.action] ?? '#6b7280';
  const isPending = params.status === 'pending_approval';
  const chainLabel = params.stablecoinChain
    ? params.stablecoinChain.charAt(0).toUpperCase() + params.stablecoinChain.slice(1)
    : '';

  let movementHtml = '';
  if (params.action !== 'no_action' && params.stablecoinToken) {
    const from = params.action === 'offramp'
      ? `${params.stablecoinToken} on ${chainLabel} (${params.walletLabel})`
      : `USD (${params.bankLabel})`;
    const to = params.action === 'offramp'
      ? `USD (${params.bankLabel})`
      : `${params.stablecoinToken} on ${chainLabel} (${params.walletLabel})`;
    movementHtml = `
      <div style="background:#f0faf9;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:13px">
        <span style="color:#111;font-weight:600">${from}</span>
        <span style="color:#999;margin:0 8px">&rarr;</span>
        <span style="color:#111;font-weight:600">${to}</span>
      </div>`;
  }

  const expirationHtml = isPending && params.expiresAt
    ? `<p style="color:#f59e0b;font-size:12px;margin:16px 0 0;text-align:center">This recommendation expires in 24 hours.</p>`
    : '';

  const ctaHtml = isPending
    ? `<div style="text-align:center;margin-top:24px">
        ${ctaButton('Review & Approve', `/treasury?reviewRec=${params.id}`)}
        <span style="display:inline-block;width:12px"></span>
        ${ctaButton('Review & Reject', `/treasury?reviewRec=${params.id}`, 'outline')}
      </div>`
    : `<div style="text-align:center;margin-top:24px">
        ${ctaButton('View Details', '/treasury')}
      </div>`;

  const statusLabels: Record<string, string> = {
    pending_approval: 'Pending Approval',
    auto_executed: 'Auto-Executed',
    approved: 'Approved',
    executed: 'Executed',
    rejected: 'Rejected',
    expired: 'Expired',
  };
  const statusLabel = statusLabels[params.status] ?? params.status;

  return emailLayout(`
    <div style="padding:32px">
      <div style="margin-bottom:20px">
        <span style="color:${actionColor};font-weight:700;font-size:16px">${actionLabel}</span>
        ${params.recommendedAmountUsd ? `<span style="font-size:20px;font-weight:700;color:#111;margin-left:8px">${fmtUsd(params.recommendedAmountUsd)}</span>` : ''}
        <span style="float:right;background:#f0f0f0;color:#666;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${statusLabel}</span>
      </div>

      <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;overflow:hidden">
        <tr>
          <td style="padding:12px 16px;text-align:center;width:33%">
            <div style="color:#999;font-size:11px;margin-bottom:4px">Fiat Balance</div>
            <div style="font-size:14px;font-weight:700;color:#111">${fmtUsd(params.totalBankBalanceUsd)}</div>
          </td>
          <td style="padding:12px 16px;text-align:center;width:33%;border-left:1px solid #eee;border-right:1px solid #eee">
            <div style="color:#999;font-size:11px;margin-bottom:4px">Obligations (${params.obligationLookaheadDays}d)</div>
            <div style="font-size:14px;font-weight:700;color:#111">${fmtUsd(params.obligationsInWindowUsd)}</div>
          </td>
          <td style="padding:12px 16px;text-align:center;width:33%">
            <div style="color:#999;font-size:11px;margin-bottom:4px">Safety Target</div>
            <div style="font-size:14px;font-weight:700;color:#111">${fmtUsd(params.safetyBufferTargetUsd)}</div>
          </td>
        </tr>
      </table>

      <div style="border-left:3px solid ${actionColor};padding:12px 16px;margin-top:16px;font-size:13px;color:#333;line-height:1.6;white-space:pre-line">${params.aiReasoning}</div>

      ${movementHtml}
      ${ctaHtml}
      ${expirationHtml}
    </div>`);
}
