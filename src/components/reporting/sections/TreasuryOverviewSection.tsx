'use client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportData } from '@/lib/treasury/report';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export function TreasuryOverviewSection({ data }: { data: ReportData }) {
  const stats = [
    { label: 'Avg Bank Balance', value: fmt(data.summary.avgBankBalanceUsd) },
    { label: 'Avg Crypto Balance', value: fmt(data.summary.avgCryptoBalanceUsd) },
    { label: 'Total On-Ramp', value: fmt(data.summary.totalOnrampUsd) },
    { label: 'Total Off-Ramp', value: fmt(data.summary.totalOfframpUsd) },
    { label: 'Net Ramp', value: fmt(data.summary.netRampUsd) },
    { label: 'Coverage Ratio', value: `${data.summary.avgObligationCoverageRatio.toFixed(2)}×` },
    { label: 'Total Fees', value: fmt(data.summary.totalFeesUsd) },
    { label: 'Recommendations', value: String(data.summary.recommendationCount) },
    { label: 'Executed', value: String(data.summary.executedCount) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Treasury Overview · {data.period.from} — {data.period.to}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-9 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
              <div className="text-base font-bold">{s.value}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
