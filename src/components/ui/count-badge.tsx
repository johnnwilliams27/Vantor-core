import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Micro count overlay. See style guide Section 02 (composite patterns).
 *
 * Shape is rounded-full (shape-mandated — at 16px height, only a circle
 * reads correctly for single-digit numbers).
 * Use for notification unread counts, "new" indicators, in-nav badge
 * counts. For semantic labels with counts, prefer <Badge>.
 */
interface CountBadgeProps {
  count: number | string;
  variant?: 'urgent' | 'active' | 'info' | 'inactive';
  /** Wraps the count with a 2px ring in the parent bg color — used
   *  when overlaying on a colored icon button so the badge pops. */
  ringed?: boolean;
  className?: string;
  /** ARIA label override — e.g. "3 unread notifications". */
  'aria-label'?: string;
}

const VARIANT_CLASSES: Record<NonNullable<CountBadgeProps['variant']>, string> = {
  urgent: 'bg-rose-500 text-white',
  active: 'bg-teal-400 text-[var(--bg-void,#060d1f)]',
  info: 'bg-blue-500 text-white',
  inactive: 'bg-gray-500 text-white',
};

export function CountBadge({
  count,
  variant = 'urgent',
  ringed,
  className,
  'aria-label': ariaLabel,
}: CountBadgeProps) {
  const display = typeof count === 'number' && count > 99 ? '99+' : String(count);
  return (
    <span
      role="status"
      aria-label={ariaLabel ?? `${count}`}
      className={cn(
        'inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-none tabular-nums',
        VARIANT_CLASSES[variant],
        ringed && 'ring-2 ring-[var(--bg-void,#060d1f)]',
        className,
      )}
    >
      {display}
    </span>
  );
}
