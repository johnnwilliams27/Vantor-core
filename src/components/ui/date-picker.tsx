'use client';

/**
 * DatePickerDropdown — the Vantor-native date picker used across the app.
 *
 * Extracted from `filter-bar.tsx` so it can be reused by pages that aren't
 * built around FilterBar (e.g. /analytics). FilterBar still re-exports this
 * internally to avoid changing any call sites.
 *
 * Shape: a compact button chip (Calendar icon + label + caret) that opens an
 * anchored month-view calendar popover. Today / Clear footer. Closes on
 * outside click or Escape.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface DatePickerDropdownProps {
  /** Label shown in the trigger when no value is selected (e.g. "From", "To"). */
  label: string;
  /** ISO date string `YYYY-MM-DD`, or empty string for unset. */
  value: string;
  onChange: (next: string) => void;
  /** Optional className override for the trigger button. */
  className?: string;
}

export function DatePickerDropdown({
  label,
  value,
  onChange,
  className,
}: DatePickerDropdownProps) {
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

    for (let i = firstDay - 1; i >= 0; i--) {
      const d = daysInPrev - i;
      const m = viewMonth === 0 ? 11 : viewMonth - 1;
      const y = viewMonth === 0 ? viewYear - 1 : viewYear;
      days.push({ day: d, month: 'prev', dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: 'current', dateStr: `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
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

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm shadow-sm transition-colors',
          'hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          open && 'ring-2 ring-teal-400/50',
          isActive && 'border-primary/50 bg-primary/5 text-primary',
          className,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}${isActive ? `: ${displayLabel}` : ''}`}
      >
        <Calendar className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', isActive && 'text-primary')} />
        <span className="truncate">{displayLabel}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
            isActive && 'text-primary',
          )}
        />
      </button>

      <div
        className={cn(
          'absolute z-50 mt-1 w-[280px] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg',
          'origin-top transition-[opacity,transform] duration-200',
          open
            ? 'pointer-events-auto translate-y-0 scale-y-100 opacity-100'
            : 'pointer-events-none -translate-y-0.5 scale-y-[0.97] opacity-0',
        )}
        role="dialog"
        aria-hidden={!open}
      >
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={prevMonth}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-1 text-center text-2xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

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
                    'h-8 w-full rounded-md text-sm transition-colors',
                    isOtherMonth && 'text-muted-foreground/40',
                    !isOtherMonth && !isSelected && 'hover:bg-accent',
                    isToday && !isSelected && 'font-semibold text-primary',
                    isSelected && 'bg-primary font-medium text-white',
                  )}
                  aria-label={day.dateStr}
                  aria-pressed={isSelected}
                >
                  {day.day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <button
              type="button"
              onClick={() => {
                setViewYear(today.getFullYear());
                setViewMonth(today.getMonth());
                selectDay(todayStr);
              }}
              className="text-xs text-primary hover:underline"
            >
              Today
            </button>
            {isActive && (
              <button
                type="button"
                onClick={clearDate}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
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

/**
 * DateRangePicker — two DatePickerDropdowns with an arrow between them.
 * Used wherever a from/to date range is needed at a page level.
 */
export interface DateRangePickerProps {
  from: string;
  to: string;
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
  fromLabel?: string;
  toLabel?: string;
}

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  fromLabel = 'From',
  toLabel = 'To',
}: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <DatePickerDropdown label={fromLabel} value={from} onChange={onFromChange} />
      <span className="text-xs text-muted-foreground/40" aria-hidden="true">
        →
      </span>
      <DatePickerDropdown label={toLabel} value={to} onChange={onToChange} />
    </div>
  );
}
