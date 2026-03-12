'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';

interface DataPoint {
  date: string;
  fiat: number;
  stablecoin: number;
  total: number;
}

function formatCompact(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as DataPoint | undefined;
  if (!d) return null;

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2.5 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1.5">
        {(() => { try { return format(new Date(label), 'MMM d, yyyy'); } catch { return label; } })()}
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#207679]" />
            <span className="text-xs text-muted-foreground">Stablecoin</span>
          </div>
          <span className="text-xs font-medium tabular-nums">{formatUsd(d.stablecoin)}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
            <span className="text-xs text-muted-foreground">Fiat</span>
          </div>
          <span className="text-xs font-medium tabular-nums">{formatUsd(d.fiat)}</span>
        </div>
        <div className="border-t pt-1 mt-1 flex items-center justify-between gap-6">
          <span className="text-xs font-medium">Total</span>
          <span className="text-xs font-semibold tabular-nums">{formatUsd(d.total)}</span>
        </div>
      </div>
    </div>
  );
}

export function BalanceOverTime() {
  const { data: session } = useSession();

  const { data: chartData, isLoading } = useQuery({
    queryKey: ['balance-history'],
    queryFn: async () => {
      const res = await fetch('/api/balance-history');
      if (!res.ok) throw new Error('Failed to fetch balance history');
      const json = await res.json();
      return json.data as DataPoint[];
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });

  const latestTotal = chartData?.length ? chartData[chartData.length - 1].total : null;

  if (!chartData?.length && !isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Treasury Over Time</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No balance data yet. Connect a wallet or bank account to get started.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Treasury Over Time</CardTitle>
          {latestTotal !== null && (
            <span className="text-lg font-semibold tabular-nums">{formatUsd(latestTotal)}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="h-[250px] flex items-center justify-center">
            <div className="h-5 w-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradStable" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#207679" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#207679" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradFiat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(v) => { try { return format(new Date(v), 'MMM'); } catch { return v; } }}
                tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                axisLine={false}
                tickLine={false}
                dy={4}
                interval="preserveStartEnd"
                minTickGap={60}
              />
              <YAxis
                tickFormatter={formatCompact}
                tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#d1d5db', strokeDasharray: '3 3' }} />
              <Area
                type="monotone"
                dataKey="fiat"
                stackId="treasury"
                stroke="#60a5fa"
                strokeWidth={1.5}
                fill="url(#gradFiat)"
              />
              <Area
                type="monotone"
                dataKey="stablecoin"
                stackId="treasury"
                stroke="#207679"
                strokeWidth={1.5}
                fill="url(#gradStable)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="flex items-center justify-center gap-5 mt-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#207679]" />
            <span className="text-xs text-foreground">Stablecoin</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
            <span className="text-xs text-foreground">Fiat</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
