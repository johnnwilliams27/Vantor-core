'use client';

import type { ViewResult } from '@/lib/analytics/types';

const LABELS: Record<string, string> = {
  total_balance_usd: 'Total Balance',
  fiat_balance_usd: 'Fiat',
  stablecoin_balance_usd: 'Stablecoin',
  defi_balance_usd: 'DeFi',
  idle_cash_usd: 'Idle Cash',
  coverage_ratio: 'Coverage',
};

function formatValue(key: string, value: number): string {
  if (key === 'coverage_ratio') return `${value.toFixed(1)}x`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function valueColor(key: string, value: number): string {
  if (key === 'idle_cash_usd') return 'text-teal-400';
  if (key === 'coverage_ratio') return value >= 1.5 ? 'text-green-400' : value >= 1 ? 'text-yellow-400' : 'text-red-400';
  return 'text-white';
}

interface KpiBannerProps {
  result: ViewResult;
}

export function KpiBanner({ result }: KpiBannerProps) {
  const scalar = result.scalar ?? {};
  const keys = Object.keys(scalar);

  return (
    <div className="rounded-xl border border-white/[0.08] bg-card p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Treasury Summary</span>
        <span className="text-xs text-muted-foreground/60">pinned</span>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {keys.map((key) => (
          <div key={key}>
            <div className="text-xs text-muted-foreground">{LABELS[key] ?? key}</div>
            <div className={`text-lg font-semibold ${valueColor(key, scalar[key])}`}>
              {formatValue(key, scalar[key])}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
