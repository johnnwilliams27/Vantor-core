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
    <div className={cn('flex items-center justify-center py-12', className)}>
      <Spinner size="md" />
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
