'use client';

import { useRouter } from 'next/navigation';
import { Pin, GitFork, Pencil, Download, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { exportCsv } from '@/lib/export/csv';
import { viewResultToCsvColumns, viewResultToCsvRows } from './export-helpers';
import { useViewQuery } from '@/hooks/useViewQuery';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';

interface ViewListRowProps {
  view: AnalyticsViewListItem;
  from: string;
  to: string;
  isPinned: boolean;
  onTogglePin: () => void;
  onFork: () => void;
  onEdit?: () => void;
}

const CHART_BADGES: Record<string, string> = {
  kpi: 'KPI',
  line: 'Line',
  bar: 'Bar',
  table: 'Table',
  donut: 'Donut',
};

export function ViewListRow({ view, from, to, isPinned, onTogglePin, onFork, onEdit }: ViewListRowProps) {
  const router = useRouter();

  // Lazy query for CSV export — only triggered on export click
  const { data: result, refetch } = useViewQuery({
    viewSlug: view.slug,
    from,
    to,
    enabled: false,
  });

  const handleCsvExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { data } = await refetch();
    if (data) {
      const cols = viewResultToCsvColumns(data);
      const rows = viewResultToCsvRows(data);
      exportCsv(`vantor-${view.slug}`, cols, rows);
    }
  };

  const isCustom = view.kind === 'custom';

  const iconBtn =
    'rounded-md p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50';

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${view.label}`}
      className={`flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 transition-colors hover:border-white/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        isCustom ? 'border-amber-500/20' : ''
      }`}
      onClick={() => router.push(`/analytics/${view.slug}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(`/analytics/${view.slug}`);
        }
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">{view.label}</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {CHART_BADGES[view.chartType] ?? view.chartType}
        </span>
        {isCustom && (
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
            custom
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`${iconBtn} ${isPinned ? 'text-teal-400 hover:text-teal-300' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
          aria-label={isPinned ? `Unpin ${view.label}` : `Pin ${view.label}`}
          aria-pressed={isPinned}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <Pin className="h-4 w-4" fill={isPinned ? 'currentColor' : 'none'} />
        </button>
        {isCustom && onEdit ? (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className={iconBtn}
            aria-label={`Edit ${view.label}`}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onFork(); }}
            className={iconBtn}
            aria-label={`Fork ${view.label}`}
            title="Fork"
          >
            <GitFork className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={handleCsvExport}
          className={iconBtn}
          aria-label={`Export ${view.label} as CSV`}
          title="CSV"
        >
          <Download className="h-4 w-4" />
        </button>
        <ChevronRight className="ml-1 h-4 w-4 shrink-0 text-muted-foreground/30" aria-hidden="true" />
      </div>
    </Card>
  );
}
