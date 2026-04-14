import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Status indicator dot. See style guide Section 04.
 *
 * Shape is always rounded-full (shape-mandated — a dot is a circle).
 * Use pulse for real-time state ("Live", "Streaming"). Use ring for
 * static emphasis. Pass label to render inline text next to the dot.
 */
export type StatusDotVariant =
  | 'active'
  | 'pending'
  | 'failed'
  | 'info'
  | 'special'
  | 'inactive'
  | 'urgent'
  | 'live';

export type StatusDotSize = 'xs' | 'sm' | 'md';

interface StatusDotProps {
  variant: StatusDotVariant;
  /** xs 6px · sm 8px (default) · md 10px */
  size?: StatusDotSize;
  /** 2s outward pulse animation. Reserved for real-time states. */
  pulse?: boolean;
  /** Soft outer glow. Emphasis without animating. */
  ring?: boolean;
  /** Optional inline label rendered to the right of the dot. */
  label?: React.ReactNode;
  className?: string;
}

const SIZE_CLASSES: Record<StatusDotSize, string> = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
};

const BG_CLASSES: Record<StatusDotVariant, string> = {
  active: 'bg-teal-400',
  pending: 'bg-amber-400',
  failed: 'bg-red-400',
  info: 'bg-blue-400',
  special: 'bg-purple-400',
  inactive: 'bg-gray-400',
  urgent: 'bg-rose-400',
  live: 'bg-green-400',
};

const RING_CLASSES: Record<StatusDotVariant, string> = {
  active: 'shadow-[0_0_0_3px_rgba(45,212,191,0.25)]',
  pending: 'shadow-[0_0_0_3px_rgba(251,191,36,0.25)]',
  failed: 'shadow-[0_0_0_3px_rgba(248,113,113,0.25)]',
  info: 'shadow-[0_0_0_3px_rgba(96,165,250,0.25)]',
  special: 'shadow-[0_0_0_3px_rgba(192,132,252,0.25)]',
  inactive: 'shadow-[0_0_0_3px_rgba(156,163,175,0.25)]',
  urgent: 'shadow-[0_0_0_3px_rgba(251,113,133,0.25)]',
  live: 'shadow-[0_0_0_3px_rgba(74,222,128,0.25)]',
};

export function StatusDot({
  variant,
  size = 'sm',
  pulse,
  ring,
  label,
  className,
}: StatusDotProps) {
  const dot = (
    <span
      className={cn(
        'inline-block rounded-full shrink-0',
        SIZE_CLASSES[size],
        BG_CLASSES[variant],
        ring && RING_CLASSES[variant],
        pulse && 'animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]',
        className,
      )}
      role={label ? undefined : 'status'}
    />
  );

  if (label === undefined) return dot;

  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}
