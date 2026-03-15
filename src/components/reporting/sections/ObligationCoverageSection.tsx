'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

interface Props {
  data: Array<{ week: string; obligationsUsd: number; avgBankBalanceUsd: number; coverageRatio: number }>;
}

export function ObligationCoverageSection({ data }: Props) {
  if (!data.length) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Weekly Obligation Coverage</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-6">No obligation coverage data for this period.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Weekly Obligation Coverage Ratio</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="week" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} width={40} />
            <Tooltip
              formatter={(v: number, name: string) => [
                name === 'coverageRatio' ? `${v.toFixed(2)}×` : fmt(v),
                name === 'coverageRatio' ? 'Coverage Ratio' : 'Obligations (USD)',
              ]}
            />
            <Bar dataKey="coverageRatio" fill="#3b82f6" radius={[4, 4, 0, 0]} name="coverageRatio" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
