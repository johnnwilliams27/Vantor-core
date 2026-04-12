import { emailLayout } from '@/lib/notifications/email-templates';

export function monthlyBillEmailHtml(params: {
  enterpriseName: string;
  billingPeriod: string;
  totalAmount: string;
}): string {
  return emailLayout(`
    <div style="padding:32px">
      <h1 style="font-size:20px;color:#fff;margin:0 0 8px">Monthly Invoice</h1>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 24px">
        Your invoice for <strong style="color:#e5e7eb">${params.billingPeriod}</strong> is ready.
      </p>
      <div style="background:rgba(45,212,191,0.08);border:1px solid rgba(45,212,191,0.2);border-radius:8px;padding:20px;text-align:center">
        <p style="color:#6b7280;font-size:12px;margin:0 0 4px">Total Amount</p>
        <p style="font-size:28px;font-weight:700;color:#2dd4bf;margin:0">${params.totalAmount}</p>
      </div>
      <p style="color:#9ca3af;font-size:13px;margin:24px 0 0">
        For detailed transaction records, log in to <a href="https://www.vantor.xyz" style="color:#2dd4bf;text-decoration:none">vantor.xyz</a>
      </p>
    </div>`);
}
