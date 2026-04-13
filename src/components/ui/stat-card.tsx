import * as React from 'react';
import { cn } from '@/lib/utils';
import { IconTile, type IconTileVariant } from './icon-tile';

/**
 * Dashboard stat card. See style guide Section 05 (card variants).
 *
 * Pattern: IconTile + label + value + trend. Hero-padded (p-8).
 * Use for the top-level metrics on dashboards.
 */
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  iconVariant?: IconTileVariant;
  /** Trend string — "+2.4%", "-$1,200", etc. */
  trend?: React.ReactNode;
  /** Direction of the trend color. */
  direction?: 'up' | 'down' | 'neutral';
  /** Context caption below trend (e.g. "this week"). */
  context?: React.ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  iconVariant = 'active',
  trend,
  direction = 'up',
  context,
  className,
}: StatCardProps) {
  const trendColor =
    direction === 'up'
      ? 'text-green-400'
      : direction === 'down'
        ? 'text-red-400'
        : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'rounded-lg border border-white/[0.08] bg-card p-8 shadow-card',
        className,
      )}
    >
      <div className="flex items-start gap-4">
        {icon && (
          <IconTile variant={iconVariant} size="md">
            {icon}
          </IconTile>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-2xs uppercase tracking-wider font-semibold text-muted-foreground">
            {label}
          </div>
          <div className="text-3xl font-bold text-foreground tracking-tight tabular-nums mt-2 leading-tight">
            {value}
          </div>
          {trend && (
            <div className={cn('text-xs font-semibold mt-1.5', trendColor)}>
              {trend}
              {context && (
                <span className="text-muted-foreground font-normal ml-1">
                  {context}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
