import * as React from 'react';
import { cn } from '@/lib/utils';
import { StatusDot } from './status-dot';
import { formatRelativeOrDate } from '@/lib/utils';

/**
 * Freshness indicator — colored dot + relative time. See style guide
 * Section 02 (composite patterns).
 *
 * Green thresholds = active, amber = pending (stale), red = failed (very stale).
 * Pass Date | null | undefined — renders em-dash for missing values.
 */
interface FreshnessBadgeProps {
  /** ISO timestamp or Date of the last update. */
  timestamp?: Date | string | null;
  /** Hours threshold before amber kicks in (default 24h). */
  amberAfterHours?: number;
  /** Hours threshold before red kicks in (default 7 days = 168h). */
  redAfterHours?: number;
  className?: string;
}

export function FreshnessBadge({
  timestamp,
  amberAfterHours = 24,
  redAfterHours = 168,
  className,
}: FreshnessBadgeProps) {
  if (!timestamp) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border border-gray-500/20 bg-gray-500/10 text-gray-400 text-xs font-medium',
          className,
        )}
      >
        <StatusDot variant="inactive" size="xs" />
        —
      </span>
    );
  }

  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const ageHours = (Date.now() - date.getTime()) / 3_600_000;

  let variant: 'active' | 'pending' | 'failed' = 'active';
  let bg = 'bg-teal-500/10';
  let border = 'border-teal-500/20';
  let text = 'text-teal-400';

  if (ageHours > redAfterHours) {
    variant = 'failed';
    bg = 'bg-red-500/10';
    border = 'border-red-500/20';
    text = 'text-red-400';
  } else if (ageHours > amberAfterHours) {
    variant = 'pending';
    bg = 'bg-amber-500/10';
    border = 'border-amber-500/20';
    text = 'text-amber-400';
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-xs font-medium',
        bg,
        border,
        text,
        className,
      )}
    >
      <StatusDot variant={variant} size="xs" />
      {formatRelativeOrDate(date.toISOString()).text}
    </span>
  );
}
