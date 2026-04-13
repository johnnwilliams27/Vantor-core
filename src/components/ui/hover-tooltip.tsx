'use client';

/**
 * HoverTooltip — lightweight hover tooltip for icon buttons and compact
 * triggers.
 *
 * Uses pure Tailwind `group-hover:block` (same pattern as TestModeToggle)
 * rather than Radix Tooltip or a portal, so it ships without new deps and
 * renders inline. Good for short labels ("Pin", "Unpin", "Fork", "Export CSV").
 *
 * For rich content (multi-line descriptions, links), use `InfoTooltip` which
 * is portal-positioned and viewport-aware.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface HoverTooltipProps {
  /** Text shown on hover/focus. Keep short — wraps to one line. */
  label: string;
  /** Any trigger element (typically a button or icon). */
  children: ReactNode;
  /** Which side to anchor on. Defaults to 'top'. */
  side?: 'top' | 'bottom';
  /** Optional wrapper className. */
  className?: string;
}

export function HoverTooltip({
  label,
  children,
  side = 'top',
  className,
}: HoverTooltipProps) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1 text-xs font-medium text-foreground shadow-lg',
          'opacity-0 scale-95 transition-[opacity,transform] duration-150 ease-out',
          'group-hover:opacity-100 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:scale-100',
          side === 'top' && 'bottom-full mb-1.5 origin-bottom',
          side === 'bottom' && 'top-full mt-1.5 origin-top',
        )}
      >
        {label}
      </span>
    </span>
  );
}
