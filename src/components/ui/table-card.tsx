import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Table wrapper card. See style guide Section 05.
 *
 * Header bar (title + subtitle + trailing action) sits above a
 * full-width table that fills the card edge-to-edge (no internal
 * padding around the table itself).
 */
interface TableCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Trailing header content — buttons, filter bar, etc. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function TableCard({
  title,
  subtitle,
  action,
  children,
  className,
}: TableCardProps) {
  const hasHeader = title || subtitle || action;

  return (
    <div
      className={cn(
        'rounded-lg border border-white/[0.08] bg-card shadow-card overflow-hidden',
        className,
      )}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="min-w-0">
            {title && (
              <div className="text-sm font-semibold text-foreground">{title}</div>
            )}
            {subtitle && (
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {subtitle}
              </div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
