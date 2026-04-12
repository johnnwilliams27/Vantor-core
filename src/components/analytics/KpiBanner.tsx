'use client';

import { Card } from '@/components/ui/card';
import type { ViewResult } from '@/lib/analytics/types';

// Compact labels for the KPI banner (shorter than full MEASURES labels for header density)
const LABELS: Record<string, string> = {
  total_balance_usd: 'Total Balance',
  fiat_balance_usd: 'Fiat',
  stablecoin_balance_usd: 'Stablecoin',
  defi_balance_usd: 'DeFi',
  idle_cash_usd: 'Idle Cash',
  coverage_ratio: 'Coverage',
};

function formatValue(key: string, value: number, hasData: boolean): string {
  if (!hasData) return '—';
  if (key === 'coverage_ratio') return `${value.toFixed(1)}x`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function valueColor(key: string, value: number, hasData: boolean): string {
  if (!hasData) return 'text-muted-foreground/40';
  if (key === 'idle_cash_usd') return 'text-teal-400';
  if (key === 'coverage_ratio') {
    return value >= 1.5 ? 'text-green-400' : value >= 1 ? 'text-yellow-400' : 'text-red-400';
  }
  return 'text-foreground';
}

interface KpiBannerProps {
  result: ViewResult;
}

export function KpiBanner({ result }: KpiBannerProps) {
  const scalar = result.scalar ?? {};
  const keys = Object.keys(scalar);

  // Detect "no data" state: balance metrics all zero. When true, render every
  // metric as "—" in muted grey instead of "$0" / "0.0x" with severity colors —
  // otherwise zero-data enterprises look like they're failing coverage.
  const allBalancesZero =
    (scalar.total_balance_usd ?? 0) === 0 &&
    (scalar.fiat_balance_usd ?? 0) === 0 &&
    (scalar.stablecoin_balance_usd ?? 0) === 0 &&
    (scalar.defi_balance_usd ?? 0) === 0;

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-3 text-sm text-muted-foreground">Treasury Summary</div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {keys.map((key) => {
          const value = scalar[key];
          const hasData = !allBalancesZero;
          return (
            <div key={key}>
              <div className="text-xs text-muted-foreground">{LABELS[key] ?? key}</div>
              <div className={`text-lg font-semibold ${valueColor(key, value, hasData)}`}>
                {formatValue(key, value, hasData)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
