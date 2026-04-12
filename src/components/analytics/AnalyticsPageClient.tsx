'use client';

import { useState, useMemo } from 'react';
import { FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import { useAnalyticsViews } from '@/hooks/useAnalyticsViews';
import { useAnalyticsPins } from '@/hooks/useAnalyticsPins';
import { useViewQuery } from '@/hooks/useViewQuery';
import { KpiBanner } from './KpiBanner';
import { PinnedViewCard } from './PinnedViewCard';
import { ViewListRow } from './ViewListRow';
import { ForkViewModal } from './ForkViewModal';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function AnalyticsPageClient() {
  const { from: defaultFrom, to: defaultTo } = useMemo(defaultDateRange, []);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const { data: views, isLoading: viewsLoading } = useAnalyticsViews();
  const { pins, togglePin, isPinned } = useAnalyticsPins();

  const [forkSource, setForkSource] = useState<AnalyticsViewListItem | null>(null);
  const [forkOpen, setForkOpen] = useState(false);

  // Treasury Summary — always shown
  const summaryQuery = useViewQuery({ viewSlug: 'treasury-summary', from, to });

  // Pinned view queries
  const pinnedQuery1 = useViewQuery({ viewSlug: pins[0] ?? '', from, to, enabled: !!pins[0] });
  const pinnedQuery2 = useViewQuery({ viewSlug: pins[1] ?? '', from, to, enabled: !!pins[1] });
  const pinnedQuery3 = useViewQuery({ viewSlug: pins[2] ?? '', from, to, enabled: !!pins[2] });
  const pinnedQuery4 = useViewQuery({ viewSlug: pins[3] ?? '', from, to, enabled: !!pins[3] });
  const pinnedQueries = [pinnedQuery1, pinnedQuery2, pinnedQuery3, pinnedQuery4];

  const standardViews = (views ?? []).filter((v) => v.kind === 'standard' && v.slug !== 'treasury-summary');
  const customViews = (views ?? []).filter((v) => v.kind === 'custom');

  // Exclude pinned views from the all-views list (they're shown above)
  const unpinnedStandard = standardViews.filter((v) => !isPinned(v.slug));
  const unpinnedCustom = customViews.filter((v) => !isPinned(v.slug));

  const handleFork = (view: AnalyticsViewListItem) => {
    setForkSource(view);
    setForkOpen(true);
  };

  const handleGenerateReport = async () => {
    // Download page-level report of pinned views
    const res = await fetch('/api/analytics/export/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vantor-analytics-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (viewsLoading) {
    return (
      <div className="p-4 sm:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-white/5" />
          <div className="h-24 rounded-xl bg-white/5" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-40 rounded-xl bg-white/5" />
            <div className="h-40 rounded-xl bg-white/5" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            {standardViews.length + 1} standard views{customViews.length > 0 ? ` + ${customViews.length} custom` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <Button
            size="sm"
            className="btn-gradient"
            onClick={() => { setForkSource(standardViews[0] ?? null); setForkOpen(true); }}
          >
            + New View
          </Button>
          <Button size="sm" variant="outline" onClick={handleGenerateReport}>
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Generate Report
          </Button>
        </div>
      </div>

      {/* KPI Banner — always pinned */}
      {summaryQuery.data && (
        <div className="mb-4">
          <KpiBanner result={summaryQuery.data} />
        </div>
      )}

      {/* Pinned views */}
      {pins.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {pins.map((slug, i) => {
            const query = pinnedQueries[i];
            if (!query?.data) return null;
            return (
              <PinnedViewCard
                key={slug}
                result={query.data}
                onUnpin={() => togglePin(slug)}
              />
            );
          })}
        </div>
      )}

      {/* All Views */}
      <div>
        <div className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
          All Views
        </div>
        <div className="space-y-2">
          {unpinnedStandard.map((view) => (
            <ViewListRow
              key={view.slug}
              view={view}
              from={from}
              to={to}
              isPinned={false}
              onTogglePin={() => togglePin(view.slug)}
              onFork={() => handleFork(view)}
            />
          ))}
        </div>

        {customViews.length > 0 && (
          <>
            <div className="mb-3 mt-6 text-xs font-medium uppercase tracking-wider text-muted-foreground/60">
              My Custom Views
            </div>
            <div className="space-y-2">
              {unpinnedCustom.map((view) => (
                <ViewListRow
                  key={view.slug}
                  view={view}
                  from={from}
                  to={to}
                  isPinned={false}
                  onTogglePin={() => togglePin(view.slug)}
                  onFork={() => handleFork(view)}
                  onEdit={() => handleFork(view)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Fork modal */}
      <ForkViewModal
        open={forkOpen}
        onOpenChange={setForkOpen}
        sourceView={forkSource}
        from={from}
        to={to}
      />
    </div>
  );
}
