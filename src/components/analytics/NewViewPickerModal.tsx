'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AnalyticsViewListItem } from '@/hooks/useAnalyticsViews';

interface NewViewPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: AnalyticsViewListItem[];
  onPick: (source: AnalyticsViewListItem) => void;
}

export function NewViewPickerModal({ open, onOpenChange, sources, onPick }: NewViewPickerModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New View</DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <p className="mb-3 text-sm text-muted-foreground">
            Pick a standard view to fork. You&apos;ll be able to customize the name, chart type, and granularity.
          </p>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {sources.map((view) => (
              <button
                key={view.slug}
                onClick={() => onPick(view)}
                className="group flex w-full items-start gap-3 rounded-lg border border-white/[0.06] bg-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{view.label}</div>
                  {view.description && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {view.description}
                    </div>
                  )}
                </div>
                <span className="shrink-0 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {view.chartType}
                </span>
              </button>
            ))}
            {sources.length === 0 && (
              <p className="text-sm text-muted-foreground/60">No standard views available.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
