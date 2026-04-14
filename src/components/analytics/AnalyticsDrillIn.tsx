'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, GitFork, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateRangePicker } from '@/components/ui/date-picker';
import { useViewQuery } from '@/hooks/useViewQuery';
import { useAnalyticsViews } from '@/hooks/useAnalyticsViews';
import { KpiBanner } from './KpiBanner';
import { ViewChart } from './ViewChart';
import { ViewTable } from './ViewTable';
import { ForkViewModal } from './ForkViewModal';
import { viewResultToCsvColumns, viewResultToCsvRows } from './export-helpers';
import { exportCsv } from '@/lib/export/csv';
import { exportPdf } from '@/lib/export/pdf';
import type { TimeGranularity } from '@/lib/analytics/types';

const GRANULARITY_OPTIONS: TimeGranularity[] = ['day', 'week', 'month'];

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function AnalyticsDrillIn() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const { from: defaultFrom, to: defaultTo } = useMemo(defaultDateRange, []);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [forkOpen, setForkOpen] = useState(false);

  const { data: views } = useAnalyticsViews();
  const viewDef = (views ?? []).find((v) => v.slug === slug) ?? null;

  const hasTimeDimension = viewDef?.config
    ? (viewDef.config as Record<string, unknown>).primaryDimension === 'time'
    : false;

  const { data: result, isLoading, isError } = useViewQuery({
    viewSlug: slug,
    from,
    to,
    granularity: hasTimeDimension ? granularity : undefined,
  });

  const handleCsvExport = () => {
    if (!result) return;
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    exportCsv(`vantor-${slug}`, cols, rows);
  };

  const handlePdfExport = () => {
    if (!result) return;
    const cols = viewResultToCsvColumns(result);
    const rows = viewResultToCsvRows(result);
    exportPdf(`vantor-${slug}`, result.view.label, cols, rows);
  };

  return (
    <div className="p-4 sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/analytics')}
            aria-label="Back to Analytics"
            className="h-10 w-10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{viewDef?.label ?? slug}</h1>
            {viewDef?.description && (
              <p className="text-sm text-muted-foreground">{viewDef.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setForkOpen(true)}>
            <GitFork className="mr-1.5 h-3.5 w-3.5" />
            Fork
          </Button>
          <Button variant="outline" size="sm" onClick={handleCsvExport}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePdfExport}>
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Controls bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {hasTimeDimension && (
          <div className="flex gap-1" role="group" aria-label="Granularity">
            {GRANULARITY_OPTIONS.map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  granularity === g
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.15]'
                }`}
                aria-pressed={granularity === g}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        {viewDef && (
          <span className={`rounded px-1.5 py-0.5 text-3xs ${
            viewDef.kind === 'custom' ? 'bg-amber-500/10 text-amber-400' : 'bg-white/5 text-muted-foreground'
          }`}>
            {viewDef.kind}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="animate-pulse rounded-xl bg-white/5 py-32" />
      )}
      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center text-sm text-red-400">
          Failed to load view data. Try adjusting the date range.
        </div>
      )}
      {result && (
        <div className="rounded-xl border border-white/[0.08] bg-card p-4 sm:p-6">
          {result.view.chartType === 'kpi' && <KpiBanner result={result} />}
          {(result.view.chartType === 'line' || result.view.chartType === 'bar') && (
            <ViewChart result={result} height={400} />
          )}
          {result.view.chartType === 'table' && <ViewTable result={result} />}
        </div>
      )}

      {/* Fork modal */}
      <ForkViewModal
        open={forkOpen}
        onOpenChange={setForkOpen}
        sourceView={viewDef}
        from={from}
        to={to}
      />
    </div>
  );
}
