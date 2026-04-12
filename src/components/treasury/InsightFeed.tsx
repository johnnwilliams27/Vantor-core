'use client';
import { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/spinner';
import { useInsights, useMarkAllInsightsViewed } from '@/hooks/useInsights';
import { InsightCard } from './InsightCard';
import { Lightbulb } from 'lucide-react';

/**
 * InsightFeed — the Treasury Insights Engine UI surface.
 *
 * Lists active insights (`new` + `viewed` state) for the current user,
 * newest first. On the first render where at least one `new`-state
 * insight is present, fires a single `POST /api/insights/mark-all-viewed`
 * to transition the whole feed server-side in one UPDATE. Guarded by a
 * ref so refetches don't re-trigger the sweep mid-session.
 *
 * Lives on the Treasury AI overview tab (see `TreasuryPageClient`).
 */
export function InsightFeed() {
  const { data: insights, isLoading, isError, error } = useInsights();
  const markAllViewed = useMarkAllInsightsViewed();

  // Ensures the mark-all-viewed sweep fires at most once per mount,
  // even if refetches return fresh `new`-state insights later. The
  // server endpoint is idempotent (no-ops when nothing to transition),
  // but we still want to skip the round-trip when the ref is set.
  const sweptRef = useRef(false);

  useEffect(() => {
    if (sweptRef.current) return;
    if (!insights?.length) return;
    if (!insights.some((i) => i.state === 'new')) return;
    sweptRef.current = true;
    // Fire-and-forget. Errors are swallowed — the list will refresh
    // on the next refetch tick regardless.
    markAllViewed.mutate();
    // markAllViewed is stable across renders; intentionally omitted
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
          <CardSkeleton rows={4} />
        ) : isError ? (
          <div className="text-sm text-destructive text-center py-8">
            {(error as Error).message || 'Failed to load insights'}
          </div>
        ) : !insights?.length ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            No active insights. The treasury engine analyses your position every 15 minutes and surfaces recommendations here.
          </div>
        ) : (
          <div className="space-y-3 max-h-[735px] overflow-y-auto pr-1">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
