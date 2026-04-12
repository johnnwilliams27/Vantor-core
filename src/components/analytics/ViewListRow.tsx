'use client';

import { useRouter } from 'next/navigation';
import { Pin, GitFork, Pencil, Download, ChevronRight } from 'lucide-react';
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

  return (
    <div
      className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition-colors hover:border-white/[0.15] ${
        isCustom ? 'border-amber-500/20 bg-card' : 'border-white/[0.08] bg-card'
      }`}
      onClick={() => router.push(`/analytics/${view.slug}`)}
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
      <div className="flex items-center gap-1.5">
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`rounded p-1 hover:bg-white/5 ${isPinned ? 'text-teal-400' : 'text-muted-foreground/40'}`}
          title={isPinned ? 'Unpin' : 'Pin'}
        >
          <Pin className="h-3.5 w-3.5" fill={isPinned ? 'currentColor' : 'none'} />
        </button>
        {isCustom && onEdit ? (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="rounded p-1 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onFork(); }}
            className="rounded p-1 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground"
            title="Fork"
          >
            <GitFork className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={handleCsvExport}
          className="rounded p-1 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground"
          title="CSV"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
        <ChevronRight className="h-4 w-4 text-muted-foreground/30" />
      </div>
    </div>
  );
}
