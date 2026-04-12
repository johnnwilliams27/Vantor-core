'use client';
import { useTreasuryOverview } from '@/hooks/useTreasury';
import { useYieldPositions } from '@/hooks/useYield';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardError, ChartSkeleton } from '@/components/ui/spinner';
import { getVenueDisplayName } from '@/lib/yield/venues';
import { getHoldingCardPlacement } from '@/lib/treasury/holdings-category';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { useFxRates } from '@/hooks/useFxRates';

const COLORS: Record<string, string> = {
  USDC: '#3b82f6',
  USDT: '#22c55e',
  DAI: '#f59e0b',
};

// Fiat accounts get assigned from this palette in order
const FIAT_PALETTE = ['#14b8a6', '#2dd4bf', '#5eead4', '#0d9488', '#0f766e'];

// Tokenized MMFs — warm amber/orange palette so they read as cash-class
// but are visually distinct from bank balances.
const MMF_PALETTE = ['#eab308', '#f97316', '#ea580c', '#dc2626', '#d97706', '#ca8a04'];

// DeFi positions — cool indigo/violet palette to read as on-chain yield.
const DEFI_PALETTE = ['#6366f1', '#8b5cf6', '#3b82f6', '#1d4ed8', '#06b6d4', '#7c3aed'];

function makeFmt(currency: string) {
  const full = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  const compact = (v: number) => {
    const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : `${currency} `;
    if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}K`;
    return `${sym}${v.toFixed(0)}`;
  };
  return { full, compact };
}

interface SliceData {
  name: string;
  value: number;
  color: string;
  category: 'fiat' | 'stablecoin' | 'mmf' | 'defi';
}

function CustomTooltip({ active, payload, fmtFull, fxRate }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as SliceData | undefined;
  if (!d) return null;
  const fmt = fmtFull ?? ((v: number) => `$${v.toFixed(0)}`);
  const rate = fxRate ?? 1;

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} />
        <span className="text-xs font-medium">{d.name}</span>
      </div>
      <p className="text-xs tabular-nums mt-0.5 ml-4">{fmt(d.value * rate)}</p>
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
  const { data: overview, isLoading: overviewLoading, isError: overviewError, refetch: refetchOverview } = useTreasuryOverview();
  const { data: yieldPositions, isLoading: yieldLoading, isError: yieldError, refetch: refetchYield } = useYieldPositions();
  const isLoading = overviewLoading || yieldLoading;
  const isError = overviewError || yieldError;
  const { currency: dc } = useDisplayCurrency();
  const { data: fxData } = useFxRates();
  const fxRate = fxData?.rates?.[dc] ?? 1;
  const { full: fmtFull, compact: fmtCompact } = makeFmt(dc);

  const slices: SliceData[] = [];

  // ── Fiat — aggregate by currency ─────────────────────────────────
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

  // ── Stablecoin positions — aggregate by token ────────────────────
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

  // ── Yield positions — split into tokenized MMFs and DeFi ────────
  // Use the same categorization as the dashboard's UnifiedBalanceCard
  // so the pie chart matches the detailed cards. One slice per protocol
  // (multiple positions in the same protocol roll up).
  const mmfByProtocol: Record<string, number> = {};
  const defiByProtocol: Record<string, number> = {};
  for (const p of yieldPositions ?? []) {
    if (!p.is_active) continue;
    const usdValue = parseFloat(p.current_value_usd);
    if (!Number.isFinite(usdValue) || usdValue <= 0) continue;
    const placement = getHoldingCardPlacement({
      kind: 'yield_position',
      protocol: p.protocol as YieldProtocolId,
    });
    if (placement === 'cash') {
      mmfByProtocol[p.protocol] = (mmfByProtocol[p.protocol] ?? 0) + usdValue;
    } else if (placement === 'defi_positions') {
      defiByProtocol[p.protocol] = (defiByProtocol[p.protocol] ?? 0) + usdValue;
    }
  }

  let mmfIdx = 0;
  for (const [protocol, value] of Object.entries(mmfByProtocol)) {
    slices.push({
      name: getVenueDisplayName(protocol),
      value,
      color: MMF_PALETTE[mmfIdx % MMF_PALETTE.length],
      category: 'mmf',
    });
    mmfIdx++;
  }

  let defiIdx = 0;
  for (const [protocol, value] of Object.entries(defiByProtocol)) {
    slices.push({
      name: getVenueDisplayName(protocol),
      value,
      color: DEFI_PALETTE[defiIdx % DEFI_PALETTE.length],
      category: 'defi',
    });
    defiIdx++;
  }

  const total = slices.reduce((s, d) => s + d.value, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Asset Distribution</CardTitle></CardHeader>
        <CardContent>
          <ChartSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader><CardTitle>Asset Distribution</CardTitle></CardHeader>
        <CardContent>
          <CardError message="Failed to load asset data." onRetry={() => { refetchOverview(); refetchYield(); }} />
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
            <span className="text-lg font-semibold tabular-nums">{fmtFull(total * fxRate)}</span>
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
                  innerRadius={65}
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
                <Tooltip content={<CustomTooltip fmtFull={fmtFull} fxRate={fxRate} />} />
                {/* Center label — total AUM */}
                <text
                  x="50%"
                  y="48%"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="text-xs fill-muted-foreground"
                >
                  Total
                </text>
                <text
                  x="50%"
                  y="56%"
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="text-sm font-semibold fill-foreground"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {fmtCompact(total * fxRate)}
                </text>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2">
              {slices.map((s, i) => (
                <div key={`${s.name}-${i}`} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs text-foreground">{s.name}</span>
                  <span className="text-xs tabular-nums text-foreground">{fmtCompact(s.value * fxRate)}</span>
                </div>
              ))}
            </div>
      </CardContent>
    </Card>
  );
}
