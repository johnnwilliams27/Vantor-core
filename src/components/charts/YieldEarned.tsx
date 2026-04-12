'use client';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useYieldPositions, useYieldTransactions } from '@/hooks/useYield';
import { TrendingUp } from 'lucide-react';
import { CardError, ChartSkeleton } from '@/components/ui/spinner';
import { getVenueDisplayName, getVenue } from '@/lib/yield/venues';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { useFxRates } from '@/hooks/useFxRates';

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

/**
 * Chart colors per protocol. Intentionally kept local to this chart
 * (not in the venue registry) — they're rendering concerns, not venue
 * metadata.
 *
 * For unknown protocols, `getProtocolColor` falls back to a category-
 * based palette via the venue registry, so newly added MMFs show up
 * with a warm Treasury-style color instead of grey even before they
 * earn an explicit entry here.
 */
const PROTOCOL_COLORS: Record<string, string> = {
  aave_v3:           '#6366f1',
  compound_v3:       '#10b981',
  morpho_reservoir:  '#3b82f6',
  morpho_steakhouse: '#1d4ed8',
  kamino:            '#8b5cf6',
  kamino_multiply:   '#7c3aed',
  ondo_usdy:         '#06b6d4',
  sky:               '#0ea5e9',
  ethena:            '#f43f5e',
  // Tokenized MMFs — warmer palette to visually distinguish from DeFi
  buidl:             '#eab308',
  ousg:              '#f97316',
  ustb:              '#ea580c',
  benji:             '#dc2626',
  usyc:              '#d97706',
  spiko_usd:         '#ca8a04',
};

// Category-based fallback palette — used when a protocol ID has no
// explicit color above. Keeps MMFs warm and DeFi cool.
const CATEGORY_FALLBACK_COLORS: Record<string, string> = {
  tokenized_mmf:        '#f59e0b', // amber
  defi_vault:           '#3b82f6', // blue
  defi_lending_market:  '#6366f1', // indigo
};

function getProtocolColor(protocolId: string): string {
  const explicit = PROTOCOL_COLORS[protocolId];
  if (explicit) return explicit;
  const venue = getVenue(protocolId as YieldProtocolId);
  if (venue) return CATEGORY_FALLBACK_COLORS[venue.category] ?? '#94a3b8';
  return '#94a3b8';
}

function CustomTooltip({ active, payload, fmtFull, fxRate }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const fmt = fmtFull ?? ((v: number) => `$${v.toFixed(0)}`);
  const rate = fxRate ?? 1;

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2.5 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
        <span className="text-xs font-medium">{d.protocol}</span>
      </div>
      <p className="text-xs font-semibold tabular-nums mt-1 ml-4">{fmt(d.earned * rate)}</p>
    </div>
  );
}

export function YieldEarned() {
  const { data: positions, isLoading, isError, refetch } = useYieldPositions();
  const { data: transactions } = useYieldTransactions();
  const { currency: dc } = useDisplayCurrency();
  const { data: fxData } = useFxRates();
  const fxRate = fxData?.rates?.[dc] ?? 1;
  const { full: fmtFull, compact: fmtCompact } = makeFmt(dc);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Yield Earned</CardTitle></CardHeader>
        <CardContent>
          <ChartSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader><CardTitle>Yield Earned</CardTitle></CardHeader>
        <CardContent>
          <CardError message="Failed to load yield data." onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  // Total accrued yield across all active positions
  const totalYield = (positions ?? []).reduce(
    (sum, p) => sum + (p.accrued_yield_usd ? parseFloat(p.accrued_yield_usd) : 0),
    0,
  );

  // Group yield by protocol
  const yieldByProtocol: Record<string, number> = {};
  for (const p of positions ?? []) {
    const y = p.accrued_yield_usd ? parseFloat(p.accrued_yield_usd) : 0;
    if (y > 0) {
      yieldByProtocol[p.protocol] = (yieldByProtocol[p.protocol] ?? 0) + y;
    }
  }

  const chartData = Object.entries(yieldByProtocol).map(([protocol, earned]) => ({
    protocol: getVenueDisplayName(protocol),
    earned,
    fill: getProtocolColor(protocol),
  }));

  // Total deployed
  const totalDeployed = (positions ?? []).reduce(
    (sum, p) => sum + (p.current_value_usd ? parseFloat(p.current_value_usd) : 0),
    0,
  );

  if (!positions?.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Yield Earned</CardTitle></CardHeader>
        <CardContent>
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No yield positions yet. <a href="/yield" className="text-primary hover:underline">Explore yield opportunities →</a>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Yield Earned</span>
          <div className="flex items-center gap-1.5 text-green-600">
            <TrendingUp className="h-4 w-4" />
            <span className="text-lg font-bold tabular-nums">{fmtFull(totalYield * fxRate)}</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between text-sm text-foreground">
            <span>Total Deployed: {fmtFull(totalDeployed * fxRate)}</span>
            <span>{positions.length} active position{positions.length !== 1 ? 's' : ''}</span>
          </div>
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="protocol" tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} tickFormatter={(v) => fmtCompact(v * fxRate)} />
                <Tooltip content={<CustomTooltip fmtFull={fmtFull} fxRate={fxRate} />} cursor={{ fill: 'hsl(var(--foreground) / 0.05)' }} offset={20} />
                <Bar dataKey="earned" radius={[4, 4, 0, 0]} maxBarSize={80}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
