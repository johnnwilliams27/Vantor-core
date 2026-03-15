'use client';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSpinner } from '@/components/ui/spinner';

const COLORS: Record<string, string> = {
  USDC: '#3b82f6',
  USDT: '#22c55e',
  PYUSD: '#a855f7',
  DAI: '#f59e0b',
};

// Fiat accounts get assigned from this palette in order
const FIAT_PALETTE = ['#19595b', '#2d9ea2', '#3bc4c9', '#14b8a6', '#0d9488'];

function formatUsd(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);
}

function formatCompact(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

interface SliceData {
  name: string;
  value: number;
  color: string;
  category: 'fiat' | 'stablecoin';
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as SliceData | undefined;
  if (!d) return null;

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
        <span className="text-xs font-medium">{d.name}</span>
      </div>
      <p className="text-xs tabular-nums mt-0.5 ml-4">{formatUsd(d.value)}</p>
    </div>
  );
}

function renderCustomLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="text-[10px] font-medium fill-white">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function TokenDistribution() {
  const { data: overview, isLoading } = useTreasuryOverview();

  const slices: SliceData[] = [];

  // Fiat accounts
  // Fiat — aggregate by currency
  const fiatByCurrency: Record<string, number> = {};
  for (const acct of overview?.bankAccounts ?? []) {
    if (acct.currentBalanceUsd > 0) {
      const currency = (acct.currency || 'USD').toUpperCase();
      fiatByCurrency[currency] = (fiatByCurrency[currency] ?? 0) + acct.currentBalanceUsd;
    }
  }
  let fiatIdx = 0;
  for (const [currency, value] of Object.entries(fiatByCurrency)) {
    slices.push({
      name: currency,
      value,
      color: FIAT_PALETTE[fiatIdx % FIAT_PALETTE.length],
      category: 'fiat',
    });
    fiatIdx++;
  }

  // Stablecoin positions — aggregate by token
  const tokenTotals: Record<string, number> = {};
  for (const pos of overview?.cryptoPositions ?? []) {
    if (pos.usdValue > 0) {
      tokenTotals[pos.token] = (tokenTotals[pos.token] ?? 0) + pos.usdValue;
    }
  }
  for (const [token, value] of Object.entries(tokenTotals)) {
    slices.push({
      name: token,
      value,
      color: COLORS[token] ?? '#9ca3af',
      category: 'stablecoin',
    });
  }

  const total = slices.reduce((s, d) => s + d.value, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Asset Distribution</CardTitle></CardHeader>
        <CardContent>
          <CardSpinner />
        </CardContent>
      </Card>
    );
  }

  if (!slices.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Asset Distribution</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No assets yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Asset Distribution</CardTitle>
          {total > 0 && (
            <span className="text-lg font-semibold tabular-nums">{formatUsd(total)}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
          <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={slices}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={110}
                  dataKey="value"
                  label={renderCustomLabel}
                  labelLine={false}
                  strokeWidth={2}
                  stroke="hsl(var(--card))"
                >
                  {slices.map((entry, i) => (
                    <Cell key={`${entry.name}-${i}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2">
              {slices.map((s, i) => (
                <div key={`${s.name}-${i}`} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-foreground">{s.name}</span>
                  <span className="text-xs tabular-nums text-foreground">{formatCompact(s.value)}</span>
                </div>
              ))}
            </div>
      </CardContent>
    </Card>
  );
}
