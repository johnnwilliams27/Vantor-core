import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComingSoonPanelProps {
  /** Primary sentence — e.g. "Coming soon" (default). */
  headline?: string;
  /** One-paragraph description. */
  description: string;
  /** Optional secondary paragraph — e.g. workaround guidance. */
  secondary?: string;
  className?: string;
}

/**
 * Canonical "Coming soon" empty-style panel used by surfaces that are
 * temporarily disabled (bridges, swaps, scheduled payments, etc.).
 *
 * Uses the dashed-border muted treatment (not the amber Coming-soon Badge,
 * which is for integration tiles). Pairs with IconTile/EmptyStateCard.
 */
export function ComingSoonPanel({
  headline = 'Coming soon',
  description,
  secondary,
  className,
}: ComingSoonPanelProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center',
        className,
      )}
    >
      <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
      <p className="text-base font-semibold mb-2">{headline}</p>
      <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
        {description}
      </p>
      {secondary && (
        <p className="text-xs text-muted-foreground mt-4 max-w-md mx-auto">
          {secondary}
        </p>
      )}
    </div>
  );
}
