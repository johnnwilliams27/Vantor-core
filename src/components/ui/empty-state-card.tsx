import * as React from 'react';
import { cn } from '@/lib/utils';
import { IconTile, type IconTileVariant } from './icon-tile';

/**
 * Empty state card. See style guide Section 16.
 *
 * Pattern: IconTile (lg) + headline + helper + optional CTA.
 * Centered in a card with generous padding. Color signals the type
 * of emptiness — teal for feature-not-activated, gray for search-empty,
 * purple for AI-not-configured, etc.
 */
interface EmptyStateCardProps {
  icon?: React.ReactNode;
  iconVariant?: IconTileVariant;
  title: string;
  helper?: React.ReactNode;
  /** Optional CTA — pass a Button or Link. */
  cta?: React.ReactNode;
  className?: string;
}

export function EmptyStateCard({
  icon,
  iconVariant = 'active',
  title,
  helper,
  cta,
  className,
}: EmptyStateCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-white/[0.08] bg-card shadow-card flex flex-col items-center justify-center text-center px-6 py-8',
        className,
      )}
    >
      {icon && (
        <div className="mb-3.5">
          <IconTile variant={iconVariant} size="lg">
            {icon}
          </IconTile>
        </div>
      )}
      <div className="text-sm font-semibold text-foreground mb-1">{title}</div>
      {helper && (
        <div className="text-xs text-muted-foreground max-w-[280px] mb-3.5">
          {helper}
        </div>
      )}
      {cta && <div>{cta}</div>}
    </div>
  );
}
