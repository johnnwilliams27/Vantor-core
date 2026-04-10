'use client';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useYieldPositions, useYieldTransactions } from '@/hooks/useYield';
import { TrendingUp } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

const PROTOCOL_LABELS: Record<string, string> = {
  aave_v3: 'Aave V3',
  morpho: 'Morpho Blue',
  morpho_steakhouse: 'Morpho Steakhouse',
  kamino: 'Kamino Lend',
  kamino_multiply: 'Kamino Multiply',
  ondo: 'Ondo',
  sky: 'Sky sUSDS',
  ethena: 'Ethena',
  drift: 'Drift',
};

const PROTOCOL_COLORS: Record<string, string> = {
  aave_v3: '#6366f1',
  morpho: '#3b82f6',
  morpho_steakhouse: '#1d4ed8',
  kamino: '#8b5cf6',
  kamino_multiply: '#7c3aed',
  ondo: '#06b6d4',
  sky: '#0ea5e9',
  ethena: '#f43f5e',
  drift: '#a855f7',
};

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2.5 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
        <span className="text-xs font-medium">{d.protocol}</span>
      </div>
      <p className="text-xs font-semibold tabular-nums mt-1 ml-4">{formatUsd(d.earned)}</p>
    </div>
  );
}

export function YieldEarned() {
  const { data: positions, isLoading } = useYieldPositions();
  const { data: transactions } = useYieldTransactions();

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Yield Earned</CardTitle></CardHeader>
        <CardContent>
          <CardSpinner />
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
    protocol: PROTOCOL_LABELS[protocol] ?? protocol,
    earned,
    fill: PROTOCOL_COLORS[protocol] ?? '#94a3b8',
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
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No yield positions yet. Deposit stablecoins to start earning.
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
            <span className="text-lg font-bold tabular-nums">{formatUsd(totalYield)}</span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between text-sm text-foreground">
            <span>Total Deployed: {formatUsd(totalDeployed)}</span>
            <span>{positions.length} active position{positions.length !== 1 ? 's' : ''}</span>
          </div>
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="protocol" tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--foreground))' }} tickFormatter={(v) => `$${v}`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--foreground) / 0.05)' }} offset={20} />
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
