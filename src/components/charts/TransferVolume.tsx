'use client';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function TransferVolume() {
  const { data: transfers } = useQuery({
    queryKey: ['transfers-volume'],
    queryFn: async () => {
      const res = await fetch('/api/transfers');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 60_000,
  });

  // Group by week
  const weekMap: Record<string, number> = {};
  for (const p of transfers ?? []) {
    if (p.status !== 'completed') continue;
    const date = new Date(p.created_at);
    const week = `W${getWeekNumber(date)} ${date.getFullYear()}`;
    weekMap[week] = (weekMap[week] ?? 0) + parseFloat(p.amount ?? '0');
  }

  const chartData = Object.entries(weekMap)
    .slice(-8)
    .map(([week, volume]) => ({ week, volume }));

  if (!chartData.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Transfer Volume</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No completed transfers yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Transfer Volume (Weekly)</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Volume']} />
            <Bar dataKey="volume" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
