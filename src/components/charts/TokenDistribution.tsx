'use client';
import { useBalances } from '@/hooks/useBalances';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const TOKEN_COLORS: Record<string, string> = {
  USDC: '#3b82f6',
  USDT: '#22c55e',
  PYUSD: '#a855f7',
};

export function TokenDistribution() {
  const { data: balances } = useBalances();

  const totals: Record<string, number> = {};
  for (const b of balances ?? []) {
    totals[b.token] = (totals[b.token] ?? 0) + parseFloat(b.balance);
  }

  const chartData = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([token, value]) => ({ name: token, value }));

  if (!chartData.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Token Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No token balances yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Token Distribution</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              outerRadius={90}
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={TOKEN_COLORS[entry.name] ?? '#9ca3af'} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, '']} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
