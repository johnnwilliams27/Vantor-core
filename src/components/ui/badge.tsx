import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground',
        success: 'border-transparent bg-green-100 text-green-800',
        warning: 'border-transparent bg-yellow-100 text-yellow-800',
        info: 'border-transparent bg-[#19595b]/10 text-[#134849]',
        ethereum: 'border-transparent bg-[#e0e7ff] text-[#4338ca]',
        solana: 'border-transparent bg-[#fae8ff] text-[#a21caf]',
        onramp: 'border-transparent bg-[#e0f2fe] text-[#0369a1]',
        offramp: 'border-transparent bg-[#ede9fe] text-[#6d28d9]',
        usd: 'border-transparent bg-green-100 text-green-800',
        eur: 'border-transparent bg-blue-100 text-blue-800',
        gbp: 'border-transparent bg-purple-100 text-purple-800',
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
