export function monthlyBillEmailHtml(params: {
  enterpriseName: string;
  billingPeriod: string;
  totalAmount: string;
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
    <div style="padding:32px">
      <h1 style="font-size:20px;color:#111;margin:0 0 8px">Monthly Invoice</h1>
      <p style="color:#666;font-size:14px;margin:0 0 24px">
        Your invoice for <strong>${params.billingPeriod}</strong> is attached.
      </p>
      <div style="background:#f0faf9;border:1px solid #19595b33;border-radius:8px;padding:20px;text-align:center">
        <p style="color:#666;font-size:12px;margin:0 0 4px">Total Amount</p>
        <p style="font-size:28px;font-weight:700;color:#19595b;margin:0">${params.totalAmount}</p>
      </div>
      <p style="color:#666;font-size:13px;margin:24px 0 0">
        For detailed transaction records, log in to <a href="https://app.vantor.xyz" style="color:#19595b">app.vantor.xyz</a>
      </p>
    </div>
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">&copy; 2026 Vantor Treasury, Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}
