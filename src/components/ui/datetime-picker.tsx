'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

interface DateTimePickerProps {
  /** Value in datetime-local format: "YYYY-MM-DDTHH:MM" */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Minimum selectable datetime in "YYYY-MM-DDTHH:MM" format. Days before this are disabled. */
  min?: string;
}

export function DateTimePicker({ value, onChange, placeholder = 'Select date & time', min }: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse value
  const selectedDate = value ? new Date(value) : null;
  const selectedDateStr = selectedDate
    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
    : '';
  const selectedHour = selectedDate ? String(selectedDate.getHours()).padStart(2, '0') : '12';
  const selectedMinute = selectedDate ? String(selectedDate.getMinutes()).padStart(2, '0') : '00';

  const today = new Date();
  const [viewYear, setViewYear] = useState(selectedDate?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate?.getMonth() ?? today.getMonth());
  const [hour, setHour] = useState(selectedHour);
  const [minute, setMinute] = useState(selectedMinute);
  const [pickedDate, setPickedDate] = useState(selectedDateStr);

  // Sync when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
      setHour(String(d.getHours()).padStart(2, '0'));
      setMinute(String(d.getMinutes()).padStart(2, '0'));
      setPickedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
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

  const emitValue = (dateStr: string, h: string, m: string) => {
    if (dateStr) {
      onChange(`${dateStr}T${h}:${m}`);
    }
  };

  const selectDay = (dateStr: string) => {
    setPickedDate(dateStr);
    emitValue(dateStr, hour, minute);
  };

  const updateHour = (h: string) => {
    setHour(h);
    emitValue(pickedDate, h, minute);
  };

  const updateMinute = (m: string) => {
    setMinute(m);
    emitValue(pickedDate, hour, m);
  };

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const minDateStr = min ? min.slice(0, 10) : undefined;

  const isActive = !!value;
  const displayLabel = isActive && selectedDate
    ? `${MONTH_NAMES[selectedDate.getMonth()].slice(0, 3)} ${selectedDate.getDate()}, ${selectedDate.getFullYear()} at ${hour}:${minute}`
    : placeholder;

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors',
          'hover:border-ring/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open && 'ring-2 ring-ring',
          isActive && 'text-foreground',
          !isActive && 'text-muted-foreground',
        )}
      >
        <Calendar className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 text-left">{displayLabel}</span>
        <ChevronDown className={cn(
          'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180',
        )} />
      </button>

      <div
        className={cn(
          'absolute z-50 mt-1 w-[280px] rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden',
          'transition-[opacity,transform] duration-200 origin-top',
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
              <div key={d} className="text-center text-2xs font-medium text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7" role="grid">
            {calendarDays.map((day, i) => {
              const isSelected = pickedDate === day.dateStr;
              const isToday = day.dateStr === todayStr;
              const isOtherMonth = day.month !== 'current';
              const isBeforeMin = !!(minDateStr && day.dateStr < minDateStr);
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={new Date(day.dateStr).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  onClick={() => !isBeforeMin && selectDay(day.dateStr)}
                  disabled={isBeforeMin}
                  className={cn(
                    'h-8 w-full text-sm rounded-md transition-colors',
                    isBeforeMin && 'text-muted-foreground/20 cursor-not-allowed',
                    isOtherMonth && !isBeforeMin && 'text-muted-foreground/40',
                    !isOtherMonth && !isSelected && !isBeforeMin && 'hover:bg-accent',
                    isToday && !isSelected && !isBeforeMin && 'font-semibold text-primary',
                    isSelected && 'bg-primary text-white font-medium',
                  )}
                >
                  {day.day}
                </button>
              );
            })}
          </div>

          {/* Time picker */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Time</span>
            <div className="flex items-center gap-1 ml-auto">
              <select
                value={hour}
                onChange={(e) => updateHour(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer"
              >
                {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">:</span>
              <select
                value={minute}
                onChange={(e) => updateMinute(e.target.value)}
                className="h-7 rounded-md border border-input bg-background px-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring appearance-none cursor-pointer"
              >
                {['00', '15', '30', '45'].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t">
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
                onClick={() => {
                  onChange('');
                  setPickedDate('');
                  setOpen(false);
                }}
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
