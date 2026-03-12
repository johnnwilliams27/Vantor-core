'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import { Settings, Sun, Moon, Monitor, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export function SettingsMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<'success' | 'error' | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Reset confirmation when dropdown closes
  useEffect(() => {
    if (!open) {
      setConfirmArmed(false);
      setRefreshResult(null);
    }
  }, [open]);

  const handleRefresh = useCallback(async () => {
    if (!confirmArmed || refreshing) return;
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await fetch('/api/refresh-all', { method: 'POST' });
      if (res.ok) {
        setRefreshResult('success');
      } else {
        setRefreshResult('error');
      }
    } catch {
      setRefreshResult('error');
    } finally {
      setRefreshing(false);
      setConfirmArmed(false);
    }
  }, [confirmArmed, refreshing]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'p-2 rounded-lg transition-colors',
          open
            ? 'bg-[#207679]/10 text-[#207679] dark:bg-teal-500/20 dark:text-teal-300'
            : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
        )}
        title="Settings"
        aria-label="Open settings"
        aria-expanded={open}
      >
        <Settings className="h-5 w-5" />
      </button>

      {open && (
        <div className="animate-dropdown absolute right-0 top-full mt-2 w-56 z-50 rounded-xl border border-border bg-popover shadow-xl">
          {/* Theme section */}
          <div className="py-1.5 border-b border-border/60">
            <p className="px-3 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Theme</p>
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => {
                  setTheme(value);
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-sm transition-colors',
                  theme === value
                    ? 'text-[#207679] dark:text-teal-300 font-medium bg-[#207679]/10 dark:bg-teal-500/15'
                    : 'text-foreground hover:bg-black/5 dark:hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
                {theme === value && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#207679] dark:bg-teal-400" />
                )}
              </button>
            ))}
          </div>

          {/* Refresh section */}
          <div className="py-2 px-3 space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Refresh All Data</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Sync wallets, bank accounts, and ERP data. Limited to 3 per hour.
            </p>

            {/* Confirmation slider */}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="refresh-confirm" className="text-xs text-muted-foreground select-none">
                Confirm refresh
              </label>
              <button
                id="refresh-confirm"
                role="switch"
                aria-checked={confirmArmed}
                onClick={() => setConfirmArmed((v) => !v)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                  confirmArmed
                    ? 'bg-[#207679] dark:bg-teal-500'
                    : 'bg-black/15 dark:bg-white/15'
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                    confirmArmed ? 'translate-x-4' : 'translate-x-0'
                  )}
                />
              </button>
            </div>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={!confirmArmed || refreshing}
              className={cn(
                'flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                confirmArmed && !refreshing
                  ? 'bg-[#207679] text-white hover:bg-[#195a5c] dark:bg-teal-600 dark:hover:bg-teal-500 cursor-pointer'
                  : 'bg-black/5 text-muted-foreground dark:bg-white/5 cursor-not-allowed opacity-60'
              )}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing...' : 'Refresh Now'}
            </button>

            {/* Result feedback */}
            {refreshResult === 'success' && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 text-center">All data sources refreshed successfully.</p>
            )}
            {refreshResult === 'error' && (
              <p className="text-[11px] text-red-500 dark:text-red-400 text-center">Refresh failed. Please try again later.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
