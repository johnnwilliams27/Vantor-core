'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, ChevronDown, ChevronLeft, ChevronRight, Check, Calendar, Download, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
  onExportCsv?: () => void;
  onExportPdf?: () => void;
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
          isActive && 'border-[#19595b]/50 bg-[#19595b]/5 text-[#19595b]',
        )}
      >
        <span className="truncate max-w-[120px]">{displayLabel}</span>
        <ChevronDown className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
          isActive && 'text-[#19595b]',
        )} />
      </button>

      <div
        className={cn(
          'absolute z-50 mt-1 min-w-[140px] rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden',
          'transition-all duration-200 origin-top',
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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function DatePickerDropdown({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const selectedDate = value ? new Date(value + 'T00:00:00') : null;
  const [viewYear, setViewYear] = useState(selectedDate?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate?.getMonth() ?? today.getMonth());

  // Sync view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + 'T00:00:00');
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(viewYear, viewMonth, 0).getDate();

    const days: { day: number; month: 'prev' | 'current' | 'next'; dateStr: string }[] = [];

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      days.push({ day: d, month: 'prev', dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: 'current', dateStr: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    // Next month padding
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = viewMonth === 11 ? 0 : viewMonth + 1;
      const y = viewMonth === 11 ? viewYear + 1 : viewYear;
      days.push({ day: d, month: 'next', dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    return days;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const selectDay = (dateStr: string) => {
    onChange(dateStr);
    setOpen(false);
  };

  const clearDate = () => {
    onChange('');
    setOpen(false);
  };

  const isActive = !!value;
  const displayLabel = isActive
    ? `${MONTH_NAMES[selectedDate!.getMonth()]} ${selectedDate!.getDate()}, ${selectedDate!.getFullYear()}`
    : label;

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

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm shadow-sm transition-colors',
          'hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'ring-2 ring-ring',
          isActive && 'border-[#19595b]/50 bg-[#19595b]/5 text-[#19595b]',
        )}
      >
        <Calendar className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground',
          isActive && 'text-[#19595b]',
        )} />
        <span className="truncate">{displayLabel}</span>
        <ChevronDown className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
          isActive && 'text-[#19595b]',
        )} />
      </button>

      <div
        className={cn(
          'absolute z-50 mt-1 w-[280px] rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden',
          'transition-all duration-200 origin-top',
          open
            ? 'opacity-100 scale-y-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-y-[0.97] -translate-y-0.5 pointer-events-none',
        )}
      >
        <div className="p-3">
          {/* Month/Year header */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={prevMonth}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              const isSelected = value === day.dateStr;
              const isToday = day.dateStr === todayStr;
              const isOtherMonth = day.month !== 'current';
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(day.dateStr)}
                  className={cn(
                    'h-8 w-full text-sm rounded-md transition-colors',
                    isOtherMonth && 'text-muted-foreground/40',
                    !isOtherMonth && !isSelected && 'hover:bg-accent',
                    isToday && !isSelected && 'font-semibold text-[#19595b]',
                    isSelected && 'bg-[#19595b] text-white font-medium',
                  )}
                >
                  {day.day}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t">
            <button
              type="button"
              onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); selectDay(todayStr); }}
              className="text-xs text-[#19595b] hover:underline"
            >
              Today
            </button>
            {isActive && (
              <button
                type="button"
                onClick={clearDate}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            )}
          </div>
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
                  onClick={onExportCsv}
                  className="flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Export CSV"
                >
                  <Download className="h-3 w-3" />
                  CSV
                </button>
              )}
              {onExportPdf && (
                <button
                  onClick={onExportPdf}
                  className="flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Export PDF"
                >
                  <FileText className="h-3 w-3" />
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
