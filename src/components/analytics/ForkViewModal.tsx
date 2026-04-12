'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ViewChart } from './ViewChart';
import { ViewTable } from './ViewTable';
import { KpiBanner } from './KpiBanner';
import { useViewQuery } from '@/hooks/useViewQuery';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';
import type { TimeGranularity } from '@/lib/analytics/types';

interface ForkViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceView: AnalyticsViewListItem | null;
  from: string;
  to: string;
}

const CHART_OPTIONS = ['kpi', 'line', 'bar', 'table'] as const;
const GRANULARITY_OPTIONS: TimeGranularity[] = ['day', 'week', 'month'];

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ForkViewModal({ open, onOpenChange, sourceView, from, to }: ForkViewModalProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [label, setLabel] = useState('');
  const [chartType, setChartType] = useState<string>('bar');
  const [granularity, setGranularity] = useState<TimeGranularity>('day');
  const [filters] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens with a new source view
  useEffect(() => {
    if (open && sourceView) {
      setLabel('');
      setChartType(sourceView.chartType);
      const config = sourceView.config as Record<string, unknown>;
      setGranularity((config.granularity as TimeGranularity) ?? 'day');
      setError(null);
    }
  }, [open, sourceView]);

  const slug = slugify(label);
  const hasTimeDimension = sourceView?.config
    ? (sourceView.config as Record<string, unknown>).primaryDimension === 'time'
    : false;

  // Live preview
  const preview = useViewQuery({
    viewSlug: sourceView?.slug ?? '',
    from,
    to,
    granularity: hasTimeDimension ? granularity : undefined,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
    enabled: open && !!sourceView,
  });

  const handleSubmit = async () => {
    if (!sourceView || !label.trim()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const sourceConfig = sourceView.config as Record<string, unknown>;
      const res = await fetch('/api/analytics/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          slug,
          chartType,
          description: `Custom view forked from ${sourceView.label}`,
          forkedFrom: sourceView.id,
          config: {
            ...sourceConfig,
            granularity: hasTimeDimension ? granularity : undefined,
            defaultFilters: Object.keys(filters).length > 0 ? filters : undefined,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Create failed' }));
        setError(body.error ?? 'Failed to create view');
        return;
      }

      queryClient.invalidateQueries({ queryKey: ['analytics-views'] });
      onOpenChange(false);
      router.push(`/analytics/${slug}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!sourceView) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Fork View</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-xs text-muted-foreground">
            Source: {sourceView.label} ({sourceView.kind})
          </div>

          {/* Name */}
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Weekly USDC Coverage"
              className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {slug && (
              <div className="mt-1 text-xs text-muted-foreground/60">Slug: {slug}</div>
            )}
          </div>

          {/* Chart type */}
          <div>
            <label className="mb-1 block text-sm font-medium">Chart type</label>
            <div className="flex gap-2">
              {CHART_OPTIONS.map((ct) => (
                <button
                  key={ct}
                  onClick={() => setChartType(ct)}
                  className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${
                    chartType === ct
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.15]'
                  }`}
                >
                  {ct}
                </button>
              ))}
            </div>
          </div>

          {/* Granularity (only for time-dimension views) */}
          {hasTimeDimension && (
            <div>
              <label className="mb-1 block text-sm font-medium">Granularity</label>
              <div className="flex gap-2">
                {GRANULARITY_OPTIONS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors ${
                      granularity === g
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-white/[0.08] text-muted-foreground hover:border-white/[0.15]'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {preview.data && (
            <div>
              <label className="mb-1 block text-sm font-medium">Preview</label>
              <div className="rounded-lg border border-white/[0.06] bg-background p-3">
                {preview.data.view.chartType === 'kpi' && <KpiBanner result={preview.data} />}
                {(preview.data.view.chartType === 'line' || preview.data.view.chartType === 'bar') && (
                  <ViewChart result={preview.data} height={140} />
                )}
                {preview.data.view.chartType === 'table' && (
                  <ViewTable result={preview.data} pageSize={3} />
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-white/[0.08] px-4 py-2 text-sm text-muted-foreground hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!label.trim() || isSubmitting}
            className="btn-gradient rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create View'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
