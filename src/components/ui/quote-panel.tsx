import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Quote panel — special tinted teal surface with top accent bar.
 * See style guide Section 05 (card variants).
 *
 * Used for quotes/estimates where the monetary result should stand
 * out. Encapsulates the `bg-[#0a2a2a]` hardcoded hex inside this
 * primitive only — do not let that color proliferate.
 */
interface QuoteRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

interface QuotePanelProps {
  /** Top rows of quote metadata (rate, fee, network, etc.). */
  rows: QuoteRow[];
  /** Prominent result line at the bottom — large teal, tabular. */
  youReceive: React.ReactNode;
  /** Optional label for the prominent line (default "You receive"). */
  youReceiveLabel?: string;
  className?: string;
}

export function QuotePanel({
  rows,
  youReceive,
  youReceiveLabel = 'You receive',
  className,
}: QuotePanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-teal-500/20 border-t-2 border-t-teal-400 bg-[#0a2a2a] p-5',
        className,
      )}
    >
      {rows.map((row, i) => (
        <div key={i} className="flex justify-between text-xs mb-1.5 last:mb-0">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="text-foreground tabular-nums">{row.value}</span>
        </div>
      ))}
      <div className="mt-3 pt-3 border-t border-teal-500/15">
        <div className="text-3xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
          {youReceiveLabel}
        </div>
        <div className="text-lg font-bold text-teal-400 tabular-nums tracking-tight">
          {youReceive}
        </div>
      </div>
    </div>
  );
}
