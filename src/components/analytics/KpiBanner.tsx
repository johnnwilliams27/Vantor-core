'use client';

import { Card } from '@/components/ui/card';
import type { ViewResult } from '@/lib/analytics/types';

// Compact labels for the KPI banner (shorter than full MEASURES labels
// for header density). Uses Vantor canonical taxonomy (Phase C-1.5a).
const LABELS: Record<string, string> = {
  total_balance_usd: 'Total',
  // L1 rollups
  cash_and_equivalents_usd: 'Cash & Equivalents',
  yield_positions_usd: 'Yield Positions',
  // L2 detail
  bank_balance_usd: 'Bank',
  stablecoin_idle_balance_usd: 'Stablecoins',
  mmf_balance_usd: 'MMFs',
  defi_protocols_usd: 'DeFi',
  // L3 leaf detail
  defi_vault_balance_usd: 'DeFi Vaults',
  defi_lending_balance_usd: 'DeFi Lending',
  other_balance_usd: 'Other',
  // Misc
  idle_cash_usd: 'Idle Cash',
  coverage_ratio: 'Coverage',
  obligation_total_usd: 'Obligations',
  // Deprecated aliases (kept while consumers migrate in Phase C-1.5b)
  fiat_balance_usd: 'Bank',
  stablecoin_balance_usd: 'Stablecoins',
  defi_balance_usd: 'DeFi',
};

function formatValue(key: string, value: number): string {
  if (key === 'coverage_ratio') return `${value.toFixed(1)}x`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function valueColor(key: string, value: number, hasObligations: boolean): string {
  if (key === 'idle_cash_usd') return 'text-teal-400';
  if (key === 'coverage_ratio') {
    // When there are no obligations at all, coverage_ratio is undefined in the
    // domain sense — no liabilities to cover. Treat as neutral instead of red.
    if (!hasObligations) return 'text-muted-foreground';
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
  const hasObligations = (scalar.obligation_total_usd ?? 0) > 0;

  // No scalar returned at all → the view has no data. Show empty state so the
  // user doesn't stare at "$0 / 0.0x" and think the coverage is failing.
  if (keys.length === 0) {
    return (
      <Card className="p-4 sm:p-6">
        <div className="mb-2 text-sm text-muted-foreground">Treasury Summary</div>
        <p className="text-sm text-muted-foreground/60">No snapshot for this period.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-3 text-sm text-muted-foreground">Treasury Summary</div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {keys.map((key) => {
          const value = scalar[key];
          return (
            <div key={key}>
              <div className="text-xs text-muted-foreground">{LABELS[key] ?? key}</div>
              <div className={`text-lg font-semibold ${valueColor(key, value, hasObligations)}`}>
                {formatValue(key, value)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
