'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useInsights, useMarkAllInsightsViewed } from '@/hooks/useInsights';
import { useTestMode } from '@/hooks/useTestMode';
import { useToast } from '@/components/ui/toast';
import { InsightCard } from './InsightCard';
import { Lightbulb, RefreshCw } from 'lucide-react';

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
  const { testMode } = useTestMode();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/insights/refresh-test', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Refresh failed');
      const { insightsCreated, insightsSuppressed, detectorsFailed } = json.data ?? {};
      queryClient.invalidateQueries({ queryKey: ['insights', session?.user?.id] });
      toast({
        title: 'Insights refreshed',
        description: `${insightsCreated ?? 0} new, ${insightsSuppressed ?? 0} deduped${
          detectorsFailed ? `, ${detectorsFailed} detector(s) failed` : ''
        }.`,
      });
    } catch (err) {
      toast({
        title: 'Refresh failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setRefreshing(false);
    }
  };

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
        {testMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Running detectors…' : 'Refresh'}
          </Button>
        )}
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
