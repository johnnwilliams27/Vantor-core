'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import { getHoldingCardPlacement } from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { CardError, ChartSkeleton } from '@/components/ui/spinner';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { useFxRates } from '@/hooks/useFxRates';

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

function makeFormatters(currency: string) {
  const compact = (v: number): string => {
    const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
    if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}K`;
    return `${sym}${v.toFixed(0)}`;
  };
  const full = (v: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  return { compact, full };
}

function CustomTooltip({ active, payload, label, fmtFull, fxRate }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as DataPoint | undefined;
  if (!d) return null;
  const fmt = fmtFull ?? ((v: number) => `$${v.toFixed(0)}`);
  const rate = fxRate ?? 1;

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2.5 shadow-lg">
      <p className="text-xs text-muted-foreground mb-1.5">
        {(() => { try { return format(new Date(label), 'MMM d, yyyy'); } catch { return label; } })()}
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-500" />
            <span className="text-xs text-muted-foreground">Stablecoin Wallets</span>
          </div>
          <span className="text-xs font-medium tabular-nums">{fmt(d.stablecoin * rate)}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
            <span className="text-xs text-muted-foreground">Bank Balances</span>
          </div>
          <span className="text-xs font-medium tabular-nums">{fmt(d.fiat * rate)}</span>
        </div>
        <div className="border-t pt-1 mt-1 flex items-center justify-between gap-6">
          <span className="text-xs font-medium">Total</span>
          <span className="text-xs font-semibold tabular-nums">{fmt(d.total * rate)}</span>
        </div>
      </div>
    </div>
  );
}

export function BalanceOverTime() {
  const { data: session } = useSession();
  const [range, setRange] = useState<RangeKey>('3m');
  const { currency: dc } = useDisplayCurrency();
  const { data: fxData } = useFxRates();
  const fxRate = fxData?.rates?.[dc] ?? 1;
  const { compact: fmtCompact, full: fmtFull } = makeFormatters(dc);

  const { data: chartData, isLoading, isError, refetch } = useQuery({
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
  const { data: yieldPositions } = useYieldPositions();

  // Compute total using the same path as UnifiedBalanceCard so the
  // numbers always agree. Uses getHoldingCardPlacement to categorize
  // yield positions identically to the hero card.
  const currentTotal = (() => {
    if (!overview) return null;
    const fiatUsd = overview.totalBankBalanceUsd ?? 0;
    const cryptoUsd = overview.totalCryptoBalanceUsd ?? 0;
    let yieldUsd = 0;
    for (const p of (yieldPositions ?? []).filter(pos => pos.is_active)) {
      yieldUsd += parseFloat(p.current_value_usd) || 0;
    }
    return fiatUsd + cryptoUsd + yieldUsd;
  })();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Treasury Over Time</CardTitle></CardHeader>
        <CardContent>
          <ChartSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader><CardTitle>Treasury Over Time</CardTitle></CardHeader>
        <CardContent>
          <CardError message="Failed to load balance history." onRetry={() => refetch()} />
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
            <span className="text-lg font-semibold tabular-nums">{fmtFull(currentTotal * fxRate)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 pt-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50',
                range === r.key
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
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
                  <stop offset="0%" stopColor="#14b8a6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#14b8a6" stopOpacity={0.02} />
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
                tickFormatter={(v) => fmtCompact(v * fxRate)}
                tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip content={<CustomTooltip fmtFull={fmtFull} fxRate={fxRate} />} cursor={{ stroke: 'hsl(var(--border))', strokeDasharray: '3 3' }} />
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
                stroke="#14b8a6"
                strokeWidth={1.5}
                fill="url(#gradStable)"
              />
            </AreaChart>
          </ResponsiveContainer>
        <div className="flex items-center justify-center gap-5 mt-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-500" />
            <span className="text-xs text-foreground">Stablecoin Wallets</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#60a5fa]" />
            <span className="text-xs text-foreground">Bank Balances</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
