import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
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
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
