'use client';
import { cn } from '@/lib/utils';

interface SpinnerProps {
  className?: string;
  /** Use "sm" for inline/button spinners, "md" for cards, "lg" for full-page */
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ className, size = 'md' }: SpinnerProps) {
  const dims = {
    sm: 'h-5 w-5',
    md: 'h-9 w-9',
    lg: 'h-12 w-12',
  }[size];

  const ringDims = {
    sm: 'h-8 w-8',
    md: 'h-14 w-14',
    lg: 'h-20 w-20',
  }[size];

  return (
    <div className={cn('relative flex items-center justify-center', className)}>
      {/* Outer pulsing ring */}
      <div
        className={cn(
          'absolute rounded-full border border-teal-500/20 animate-[spinnerPulse_2s_ease-in-out_infinite]',
          ringDims,
        )}
      />
      {/* Spinning arc */}
      <div
        className={cn(
          'rounded-full border-2 border-transparent border-t-teal-500 border-r-teal-500/40 animate-[spinnerRotate_0.8s_linear_infinite]',
          dims,
        )}
      />
      {/* Center dot */}
      <div className="absolute h-1.5 w-1.5 rounded-full bg-teal-500 animate-[spinnerDotPulse_1.5s_ease-in-out_infinite]" />
    </div>
  );
}

/** Centered spinner for use inside Card content areas */
export function CardSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-12', className)} role="status" aria-label="Loading">
      <Spinner size="md" />
    </div>
  );
}

/** Error state for Card content areas — shows message + retry button */
export function CardError({
  message = 'Failed to load data.',
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-10 text-center', className)} role="alert">
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs font-medium text-teal-500 hover:text-teal-400 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Skeleton bar for content-shaped loading placeholders */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/60 dark:bg-white/[0.06]', className)}
      style={style}
    />
  );
}

/** Content-shaped skeleton for dashboard cards */
export function CardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-4 py-2', className)} role="status" aria-label="Loading">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <div className="space-y-2.5 pt-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-1/4" />
            <Skeleton className="h-3.5 w-1/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Chart-shaped skeleton */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('py-2', className)} role="status" aria-label="Loading">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-6 w-1/5" />
      </div>
      <div className="flex items-end gap-1 h-[200px]">
        {[40, 65, 45, 80, 55, 70, 50, 75, 60, 85, 45, 70].map((h, i) => (
          <Skeleton key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Full-page centered spinner (e.g. AppShell loading) */
export function PageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Spinner size="lg" />
    </div>
  );
}
