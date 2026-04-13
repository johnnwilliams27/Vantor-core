import { cn } from '@/lib/utils';

/**
 * Accent divider used between hero sections of operations forms
 * (ramp, swap, chain-swap) to indicate "step completed / continue below."
 *
 * Consistent gradient treatment: teal → cyan at reduced opacity.
 */
export function FormDivider({ className }: { className?: string }) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      className={cn('h-0.5 bg-gradient-to-r from-teal-500/60 to-cyan-500/40', className)}
    />
  );
}
