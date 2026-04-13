import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Badge primitive. See style guide Section 02.
 *
 * New semantic variants (active/pending/failed/blocked/info-blue/special/
 * inactive/urgent/live) are rounded-md and carry a visible 1px border
 * per the locked shape + opacity rules.
 *
 * Legacy variants (default/secondary/destructive/outline/success/warning/
 * info/ethereum/solana/onramp/offramp/usd/eur/gbp/brl/mxn) remain for
 * backward compat until Stage 3 migration.
 */
const badgeVariants = cva(
  'inline-flex items-center border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        // NEW semantic variants — rounded-md, border at /20
        active:   'border-teal-500/20 bg-teal-500/8 text-teal-400',
        pending:  'border-amber-500/20 bg-amber-500/8 text-amber-400',
        failed:   'border-red-500/20 bg-red-500/8 text-red-400',
        blocked:  'border-red-500/20 bg-red-500/8 text-red-400',
        'info-blue': 'border-blue-500/20 bg-blue-500/8 text-blue-400',
        special:  'border-purple-500/20 bg-purple-500/8 text-purple-400',
        inactive: 'border-gray-500/20 bg-gray-500/10 text-gray-400',
        urgent:   'border-rose-500/20 bg-rose-500/10 text-rose-400',
        live:     'border-green-500/20 bg-green-500/8 text-green-400',
        // LEGACY variants — preserved for backward compat (Stage 3 migrates)
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-muted text-muted-foreground',
        destructive: 'border-transparent bg-red-500/8 text-red-700 dark:bg-red-500/10 dark:text-red-400',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-green-500/8 text-green-700 dark:bg-green-500/10 dark:text-green-400',
        warning: 'border-transparent bg-amber-500/8 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
        info: 'border-transparent bg-primary/8 text-primary dark:bg-teal-500/10 dark:text-teal-400',
        ethereum: 'border-transparent bg-indigo-500/8 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
        solana: 'border-transparent bg-fuchsia-500/8 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-400',
        onramp: 'border-transparent bg-sky-500/8 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
        offramp: 'border-transparent bg-violet-500/8 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
        usd: 'border-transparent bg-green-500/8 text-green-700 dark:bg-green-500/10 dark:text-green-400',
        eur: 'border-transparent bg-blue-500/8 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
        gbp: 'border-transparent bg-purple-500/8 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
        brl: 'border-transparent bg-amber-500/8 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
        mxn: 'border-transparent bg-rose-500/8 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
      },
      size: {
        xs: 'text-3xs px-1.5 py-0 gap-1',
        sm: 'text-xs px-2 py-0.5 gap-1',
        md: 'text-xs px-2.5 py-0.5 gap-1.5',
        lg: 'text-xs px-3 py-1 gap-1.5',
      },
      shape: {
        rounded: 'rounded-md',
        pill: 'rounded-full',
      },
    },
    compoundVariants: [
      // Legacy variants default to pill (backward compat)
      { variant: 'default', shape: undefined, class: 'rounded-full' },
      { variant: 'secondary', shape: undefined, class: 'rounded-full' },
      { variant: 'destructive', shape: undefined, class: 'rounded-full' },
      { variant: 'outline', shape: undefined, class: 'rounded-full' },
      { variant: 'success', shape: undefined, class: 'rounded-full' },
      { variant: 'warning', shape: undefined, class: 'rounded-full' },
      { variant: 'info', shape: undefined, class: 'rounded-full' },
      { variant: 'ethereum', shape: undefined, class: 'rounded-full' },
      { variant: 'solana', shape: undefined, class: 'rounded-full' },
      { variant: 'onramp', shape: undefined, class: 'rounded-full' },
      { variant: 'offramp', shape: undefined, class: 'rounded-full' },
      { variant: 'usd', shape: undefined, class: 'rounded-full' },
      { variant: 'eur', shape: undefined, class: 'rounded-full' },
      { variant: 'gbp', shape: undefined, class: 'rounded-full' },
      { variant: 'brl', shape: undefined, class: 'rounded-full' },
      { variant: 'mxn', shape: undefined, class: 'rounded-full' },
    ],
    defaultVariants: { variant: 'default', size: 'sm', shape: 'rounded' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading status dot — auto-colored to match the variant. */
  dot?: boolean;
  /** Leading icon — pass an SVG or icon component. */
  icon?: React.ReactNode;
}

function Badge({ className, variant, size, shape, dot, icon, children, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size, shape }), className)} {...props}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />}
      {icon && <span className="inline-flex shrink-0 [&>svg]:w-3 [&>svg]:h-3">{icon}</span>}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };
