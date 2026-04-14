'use client';
import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronDown, Check, Download, FileText, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DatePickerDropdown } from '@/components/ui/date-picker';
import { cn } from '@/lib/utils';

interface DropdownDef {
  key: string;
  label: string;
  options: string[];
}

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  dropdowns?: DropdownDef[];
  filters: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
  showDateRange?: boolean;
  dateFrom?: string;
  dateTo?: string;
  onDateFromChange?: (v: string) => void;
  onDateToChange?: (v: string) => void;
  resultCount: number;
  totalCount: number;
  activeFilterCount: number;
  onClear: () => void;
  onExportCsv?: () => void | Promise<void>;
  onExportPdf?: () => void | Promise<void>;
  className?: string;
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function FilterDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isActive = value && value !== 'all';
  const displayLabel = isActive ? formatLabel(value) : label;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm shadow-sm transition-colors',
          'hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'ring-2 ring-ring',
          isActive && 'border-primary/50 bg-primary/5 text-primary',
        )}
      >
        <span className="truncate max-w-[120px]">{displayLabel}</span>
        <ChevronDown className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
          isActive && 'text-primary',
        )} />
      </button>

      <div
        className={cn(
          'absolute z-50 mt-1 min-w-[140px] rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden',
          'transition-[opacity,transform] duration-200 origin-top',
          open
            ? 'opacity-100 scale-y-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-y-[0.97] -translate-y-0.5 pointer-events-none',
        )}
      >
        <div className="max-h-60 overflow-y-auto py-1">
          {/* All option */}
          <button
            type="button"
            onClick={() => { onChange('all'); setOpen(false); }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
              'hover:bg-accent hover:text-accent-foreground',
              !isActive && 'text-muted-foreground',
            )}
          >
            <span className="flex-1">All</span>
            {!isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>

          {options.map((opt) => {
            const selected = value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
                  'hover:bg-accent hover:text-accent-foreground',
                  selected && 'bg-accent/50 font-medium',
                )}
              >
                <span className="flex-1 truncate">{formatLabel(opt)}</span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}


export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search...',
  dropdowns,
  filters,
  onFilterChange,
  showDateRange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  resultCount,
  totalCount,
  activeFilterCount,
  onClear,
  onExportCsv,
  onExportPdf,
  className,
}: FilterBarProps) {
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const isFiltered = activeFilterCount > 0;
  const hasExport = !!onExportCsv || !!onExportPdf;

  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-56 pl-8 text-sm"
        />
      </div>

      {/* Dropdowns */}
      {dropdowns?.map((dd) => (
        <FilterDropdown
          key={dd.key}
          label={dd.label}
          options={dd.options}
          value={filters[dd.key] ?? 'all'}
          onChange={(v) => onFilterChange(dd.key, v)}
        />
      ))}

      {/* Date range */}
      {showDateRange && (
        <>
          <DatePickerDropdown
            label="Start date"
            value={dateFrom ?? ''}
            onChange={(v) => onDateFromChange?.(v)}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <DatePickerDropdown
            label="End date"
            value={dateTo ?? ''}
            onChange={(v) => onDateToChange?.(v)}
          />
        </>
      )}

      {/* Result count + clear + export */}
      {(isFiltered || hasExport) && (
        <div className="flex items-center gap-2 ml-auto">
          {isFiltered && (
            <>
              <span className="text-xs text-muted-foreground">
                {resultCount} of {totalCount}
              </span>
              <button
                onClick={onClear}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </>
          )}

          {hasExport && (
            <div className={cn('flex items-center gap-1', isFiltered && 'ml-2 pl-2 border-l border-border')}>
              {onExportCsv && (
                <button
                  onClick={async () => {
                    setExportingCsv(true);
                    try { await onExportCsv(); } finally { setExportingCsv(false); }
                  }}
                  disabled={exportingCsv}
                  className="flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  aria-label="Export CSV"
                >
                  {exportingCsv ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  CSV
                </button>
              )}
              {onExportPdf && (
                <button
                  onClick={async () => {
                    setExportingPdf(true);
                    try { await onExportPdf(); } finally { setExportingPdf(false); }
                  }}
                  disabled={exportingPdf}
                  className="flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  aria-label="Export PDF"
                >
                  {exportingPdf ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                  PDF
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
