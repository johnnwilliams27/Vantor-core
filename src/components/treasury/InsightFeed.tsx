'use client';
import { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSpinner } from '@/components/ui/spinner';
import { useInsights, useMarkInsightViewed } from '@/hooks/useInsights';
import { InsightCard } from './InsightCard';
import { Lightbulb } from 'lucide-react';

/**
 * InsightFeed — the Treasury Insights Engine UI surface.
 *
 * Lists active insights (`new` + `viewed` state) for the current user,
 * newest first. On mount, sweeps any `new` insights to `viewed` by
 * firing a PATCH per insight. The sweep is guarded by a ref so each
 * insight ID is only marked once per mount, even across refetches.
 *
 * Lives on the Treasury AI overview tab (see `TreasuryPageClient`).
 */
export function InsightFeed() {
  const { data: insights, isLoading, isError, error } = useInsights();
  const markViewed = useMarkInsightViewed();

  // Per-mount set of insight IDs we've already marked as viewed, so
  // refetches don't re-PATCH the same insight. markViewed is idempotent
  // on the server side (no-ops when state != 'new'), but we still want
  // to avoid the unnecessary network round-trip.
  const viewedSweepRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!insights?.length) return;
    for (const insight of insights) {
      if (insight.state !== 'new') continue;
      if (viewedSweepRef.current.has(insight.id)) continue;
      viewedSweepRef.current.add(insight.id);
      // Fire-and-forget; errors are swallowed here (the store is
      // tolerant and the list will refresh on the next cron tick).
      markViewed.mutate(insight.id);
    }
    // markViewed is stable across renders but intentionally omitted
    // from deps to avoid re-running the sweep on mutation state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insights]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" />
          Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <CardSpinner />
        ) : isError ? (
          <div className="text-sm text-destructive text-center py-8">
            {(error as Error).message || 'Failed to load insights'}
          </div>
        ) : !insights?.length ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No active insights. The treasury engine analyses your position every 15 minutes and surfaces recommendations here.
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent hover:scrollbar-thumb-muted-foreground/30">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
