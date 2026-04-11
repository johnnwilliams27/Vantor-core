'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CardSpinner } from '@/components/ui/spinner';

interface DataPoint {
  date: string;
  fiat: number;
  stablecoin: number;
  total: number;
}

const RANGES = [
  { key: '1d', label: '1D' },
  { key: '7d', label: '7D' },
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

function tickFormat(v: string, range: RangeKey): string {
  try {
    const d = new Date(v);
    if (range === '1d') return format(d, 'HH:mm');
    if (range === '7d') return format(d, 'EEE');
    if (range === '1m') return format(d, 'MMM d');
    return format(d, 'MMM d');
  } catch {
    return v;
  }
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
            <span className="h-2 w-2 rounded-full bg-[#19595b]" />
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
  const [range, setRange] = useState<RangeKey>('3m');

  const { data: chartData, isLoading } = useQuery({
    queryKey: ['balance-history', range],
    queryFn: async () => {
      const res = await fetch(`/api/balance-history?range=${range}`);
      if (!res.ok) throw new Error('Failed to fetch balance history');
      const json = await res.json();
      return json.data as DataPoint[];
    },
    enabled: !!session?.user?.id,
    staleTime: 60_000,
  });

  const { data: overview } = useTreasuryOverview();
  // Current total AUM sums every bucket — bank + wallet stablecoins +
  // tokenized MMFs + DeFi positions + other yield. Matches the Total
  // Treasury card on the dashboard. The pre-fix version summed only
  // bank + crypto, which missed MMFs and DeFi entirely (or conflated
  // them into crypto via the T18 regression).
  const currentTotal = overview
    ? (overview.totalBankBalanceUsd ?? 0) +
      (overview.totalCryptoBalanceUsd ?? 0) +
      (overview.totalMmfPositionsUsd ?? 0) +
      (overview.totalDefiPositionsUsd ?? 0) +
      (overview.totalOtherYieldUsd ?? 0)
    : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Treasury Over Time</CardTitle></CardHeader>
        <CardContent>
          <CardSpinner />
        </CardContent>
      </Card>
    );
  }

  if (!chartData?.length) {
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
          {currentTotal !== null && (
            <span className="text-lg font-semibold tabular-nums">{formatUsd(currentTotal)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 pt-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                range === r.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradStable" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#19595b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#19595b" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradFiat" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(v) => tickFormat(v, range)}
                tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                axisLine={false}
                tickLine={false}
                dy={4}
                interval={Math.max(Math.floor((chartData?.length ?? 1) / 6) - 1, 0)}
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
                stroke="#19595b"
                strokeWidth={1.5}
                fill="url(#gradStable)"
              />
            </AreaChart>
          </ResponsiveContainer>
        <div className="flex items-center justify-center gap-5 mt-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#19595b]" />
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
