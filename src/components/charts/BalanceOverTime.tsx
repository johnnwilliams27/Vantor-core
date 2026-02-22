'use client';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useSession } from 'next-auth/react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';

const TOKEN_COLORS: Record<string, string> = {
  USDC: '#3b82f6',
  USDT: '#22c55e',
  PYUSD: '#a855f7',
};

function formatDate(ts: string) {
  try { return format(new Date(ts), 'MMM d'); }
  catch { return ts; }
}

export function BalanceOverTime() {
  const { data: session } = useSession();

  const { data: chartData } = useQuery({
    queryKey: ['balance-snapshots', session?.user?.id],
    queryFn: async () => {
      const supabase = createClient();
      const { data: wallets } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', session!.user.id);

      if (!wallets?.length) return [];

      const { data: snaps } = await supabase
        .from('balance_snapshots')
        .select('*')
        .in('wallet_id', wallets.map((w) => w.id))
        .order('snapped_at', { ascending: true })
        .limit(200);

      if (!snaps?.length) return [];

      // Aggregate by date+token
      const byDate: Record<string, Record<string, number>> = {};
      for (const s of snaps) {
        const day = s.snapped_at.split('T')[0];
        if (!byDate[day]) byDate[day] = {};
        byDate[day][s.token] = (byDate[day][s.token] ?? 0) + parseFloat(s.balance);
      }

      return Object.entries(byDate).map(([date, tokens]) => ({
        date,
        ...tokens,
      }));
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });

  if (!chartData?.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Balance Over Time</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No historical data yet. Balances are snapshotted every 5 minutes.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle>Balance Over Time</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              labelFormatter={(v) => `Date: ${v}`}
              formatter={(value: number) => [`$${value.toFixed(2)}`, '']}
            />
            <Legend />
            {['USDC', 'USDT', 'PYUSD'].map((token) => (
              <Line
                key={token}
                type="monotone"
                dataKey={token}
                stroke={TOKEN_COLORS[token]}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
