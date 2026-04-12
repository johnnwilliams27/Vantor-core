'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
// Theme toggle removed — dark mode only. useTheme kept for forcing dark.
import { RefreshCw, DollarSign, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDisplayCurrency } from '@/hooks/useDisplayCurrency';
import { SUPPORTED_FIAT_CURRENCIES } from '@/lib/fx/rates';

const CURRENCY_LABELS: Record<string, string> = {
  USD: 'USD ($)',
  EUR: 'EUR (€)',
  GBP: 'GBP (£)',
  BRL: 'BRL (R$)',
  MXN: 'MXN (MX$)',
};


interface SettingsMenuProps {
  userInitial: string;
  userName?: string;
  userEmail?: string;
  userRole: string;
  onSignOut: () => void;
}

export function SettingsMenu({ userInitial, userName, userEmail, userRole, onSignOut }: SettingsMenuProps) {
  const { setTheme } = useTheme();
  const { currency: displayCurrency, setCurrency: setDisplayCurrency } = useDisplayCurrency();

  // Force dark mode
  useEffect(() => { setTheme('dark'); }, [setTheme]);
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
      setRefreshResult(res.ok ? 'success' : 'error');
    } catch {
      setRefreshResult('error');
    } finally {
      setRefreshing(false);
      setConfirmArmed(false);
    }
  }, [confirmArmed, refreshing]);

  const roleLabel = userRole.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:ring-2 hover:ring-primary/30 transition-shadow"
        aria-label="Open settings"
        aria-expanded={open}
      >
        {userInitial}
      </button>

      {open && (
        <div className="animate-dropdown absolute right-0 top-full mt-2 w-64 z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          {/* User info */}
          <div className="px-4 py-3 border-b border-border/60">
            <p className="text-sm font-medium text-foreground truncate">{userName ?? 'User'}</p>
            {userEmail && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{userEmail}</p>
            )}
            <p className="text-[11px] text-muted-foreground mt-1">{roleLabel}</p>
          </div>

          {/* Display currency */}
          <div className="py-1.5 border-b border-border/60">
            <p className="px-4 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Display Currency</p>
            {SUPPORTED_FIAT_CURRENCIES.map((cur) => (
              <button
                key={cur}
                onClick={() => setDisplayCurrency(cur)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors',
                  displayCurrency === cur
                    ? 'text-primary font-medium bg-primary/5'
                    : 'text-foreground hover:bg-muted/50'
                )}
              >
                <DollarSign className="h-4 w-4 shrink-0" />
                {CURRENCY_LABELS[cur] ?? cur}
                {displayCurrency === cur && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <div className="py-2.5 px-4 space-y-2 border-b border-border/60">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Refresh All Data</p>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="refresh-confirm" className="text-xs text-muted-foreground select-none">
                Confirm
              </label>
              <button
                id="refresh-confirm"
                role="switch"
                aria-checked={confirmArmed}
                onClick={() => setConfirmArmed((v) => !v)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200',
                  confirmArmed ? 'bg-primary' : 'bg-black/15 dark:bg-white/15'
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
            <button
              onClick={handleRefresh}
              disabled={!confirmArmed || refreshing}
              className={cn(
                'flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                confirmArmed && !refreshing
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer'
                  : 'bg-muted text-muted-foreground cursor-not-allowed opacity-60'
              )}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing…' : 'Refresh Now'}
            </button>
            {refreshResult === 'success' && (
              <p className="text-[11px] text-green-600 dark:text-green-400 text-center">All data sources refreshed.</p>
            )}
            {refreshResult === 'error' && (
              <p className="text-[11px] text-red-500 dark:text-red-400 text-center">Refresh failed. Try again later.</p>
            )}
          </div>

          {/* Sign out */}
          <button
            onClick={onSignOut}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
