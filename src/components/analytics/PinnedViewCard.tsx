'use client';

import { useRouter } from 'next/navigation';
import { Pin, Download } from 'lucide-react';
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
    <div
      className="cursor-pointer rounded-xl border border-white/[0.08] bg-card p-4 transition-colors hover:border-white/[0.15]"
      onClick={() => router.push(`/analytics/${slug}`)}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onUnpin(); }}
            className="text-teal-400 hover:text-teal-300"
            title="Unpin"
          >
            <Pin className="h-3.5 w-3.5" fill="currentColor" />
          </button>
          <button
            onClick={handleCsvExport}
            className="text-muted-foreground/60 hover:text-muted-foreground"
            title="Export CSV"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {chartType === 'kpi' && <KpiBanner result={result} />}
      {(chartType === 'line' || chartType === 'bar') && <ViewChart result={result} height={160} />}
      {chartType === 'table' && <ViewTable result={result} pageSize={5} />}
    </div>
  );
}
