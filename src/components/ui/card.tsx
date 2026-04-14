import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Card primitive. See style guide Section 05.
 *
 * Default variant = rounded-lg + subtle shadow + border. Matches the
 * locked style-guide rules (decision 1B rounded-lg · 2C subtle shadow).
 *
 * Backward compat: existing <Card /> callers (no variant prop) get the
 * new default styling — a slight shift from rounded-xl to rounded-lg
 * plus the 0 2px 6px /25 shadow. Intentional per style guide.
 */
const cardVariants = cva(
  'border text-card-foreground',
  {
    variants: {
      variant: {
        /** Flat content card with subtle shadow. Default. */
        default: 'rounded-lg bg-card border-white/[0.08] shadow-card',
        /** Floating above the page — dialogs, popovers, menus. */
        elevated: 'rounded-lg bg-[#0a1628] border-white/[0.08] shadow-elevated',
        /** Hoverable card — border brightens toward teal + bg lightens on hover. */
        interactive:
          'rounded-lg bg-card border-white/[0.08] shadow-card cursor-pointer transition-colors hover:border-teal-400/30 hover:bg-[#111e33]',
        /** Tinted teal surface with top accent bar — quote panels. */
        quote: 'rounded-lg bg-[#0a2a2a] border-teal-500/20 border-t-2 border-t-teal-400',
      },
      density: {
        dense: 'p-4',
        default: 'p-6',
        hero: 'p-8',
        none: '',
      },
    },
    defaultVariants: { variant: 'default', density: 'none' },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, density, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, density }), className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

/**
 * CardHeader — default shadcn-style (children-based, padded).
 * For the prescriptive header pattern (icon + title + subtitle + trailing),
 * use CardHeaderRich below.
 */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  )
);
CardHeader.displayName = 'CardHeader';

/**
 * Prescriptive rich header. See style guide Section 05.
 *
 * Layout: optional IconTile + title + optional subtitle + optional
 * trailing element (badge, action button). Use inside a <Card density="none" />
 * and place content below in a separate wrapper with padding.
 */
interface CardHeaderRichProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
}

const CardHeaderRich = React.forwardRef<HTMLDivElement, CardHeaderRichProps>(
  ({ className, icon, title, subtitle, trailing, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-start gap-3.5 mb-4', className)}
      {...props}
    >
      {icon && <div className="shrink-0">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold text-foreground leading-tight">
          {title}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        )}
      </div>
      {trailing && (
        <div className="shrink-0 flex items-center gap-2">{trailing}</div>
      )}
    </div>
  )
);
CardHeaderRich.displayName = 'CardHeaderRich';

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

/**
 * CardFooter with optional top divider. Pass `divider` to get the
 * border-top separator used in rich cards with actions (per style guide).
 */
interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  divider?: boolean;
}

const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, divider, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-between',
        divider ? 'mt-5 pt-4 border-t border-white/[0.08]' : 'p-6 pt-0',
        className,
      )}
      {...props}
    />
  )
);
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardHeader,
  CardHeaderRich,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  cardVariants,
};
