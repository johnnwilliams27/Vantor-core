'use client';

import { useRouter } from 'next/navigation';
import { Pin, Download } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ViewChart } from './ViewChart';
import { ViewTable } from './ViewTable';
import { KpiBanner } from './KpiBanner';
import { viewResultToCsvColumns, viewResultToCsvRows } from './export-helpers';
import { exportCsv } from '@/lib/export/csv';
import type { ViewResult } from '@/lib/analytics/types';

interface PinnedViewCardProps {
  result: ViewResult;
  onUnpin: () => void;
}

export function PinnedViewCard({ result, onUnpin }: PinnedViewCardProps) {
  const router = useRouter();
  const { slug, label, chartType } = result.view;

  const handleCsvExport = (e: React.MouseEvent) => {
    e.stopPropagation();
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    exportCsv(`vantor-${slug}`, cols, rows);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${label}`}
      className="cursor-pointer p-4 transition-colors hover:border-white/[0.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={() => router.push(`/analytics/${slug}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          router.push(`/analytics/${slug}`);
        }
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onUnpin(); }}
            className="rounded p-2 text-teal-400 hover:bg-white/5 hover:text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50"
            aria-label={`Unpin ${label}`}
            title="Unpin"
          >
            <Pin className="h-4 w-4" fill="currentColor" />
          </button>
          <button
            onClick={handleCsvExport}
            className="rounded p-2 text-muted-foreground/60 hover:bg-white/5 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50"
            aria-label={`Export ${label} as CSV`}
            title="Export CSV"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
      {chartType === 'kpi' && <KpiBanner result={result} />}
      {(chartType === 'line' || chartType === 'bar') && <ViewChart result={result} height={160} />}
      {chartType === 'table' && <ViewTable result={result} pageSize={5} />}
    </Card>
  );
}
