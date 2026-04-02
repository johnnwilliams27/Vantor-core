'use client';
import { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { AuditLog } from '@/types/database';

const ACTION_LABEL: Record<string, string> = {
  erp_connect: 'ERP Connect',
  gl_post:     'GL Post',
};
const actionLabel = (action: string) =>
  ACTION_LABEL[action] ?? action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const ACTION_DOT: Record<string, string> = {
  login:                            'bg-violet-500',
  logout:                           'bg-violet-400',
  transfer_create:                  'bg-amber-500',
  transfer_schedule:                'bg-amber-500',
  transfer_execute:                 'bg-orange-500',
  swap_execute:                     'bg-blue-500',
  wallet_connect:                   'bg-green-500',
  wallet_disconnect:                'bg-red-500',
  invoice_sync:                     'bg-indigo-500',
  erp_connect:                      'bg-indigo-500',
  gl_post:                          'bg-slate-500',
  treasury_rule_create:             'bg-cyan-500',
  treasury_rule_update:             'bg-cyan-400',
  treasury_obligation_create:       'bg-purple-500',
  treasury_obligation_delete:       'bg-purple-400',
  treasury_recommendation_generate: 'bg-sky-500',
  treasury_recommendation_approve:  'bg-emerald-500',
  treasury_recommendation_reject:   'bg-rose-500',
  treasury_recommendation_execute:  'bg-teal-500',
  treasury_forecast_generate:       'bg-pink-500',
  treasury_simulation_run:          'bg-fuchsia-500',
  treasury_report_export:           'bg-slate-400',
  treasury_price_refresh:           'bg-lime-500',
  scheduled_operation_create:       'bg-indigo-500',
  scheduled_operation_execute:      'bg-emerald-500',
  scheduled_operation_deviation:    'bg-amber-500',
  scheduled_operation_approve:      'bg-green-500',
  scheduled_operation_cancel:       'bg-red-500',
  scheduled_operation_expire:       'bg-gray-500',
  fiat_payment_create:              'bg-purple-500',
  fiat_payment_execute:             'bg-purple-400',
  fiat_payment_cancel:              'bg-red-500',
  fiat_payment_settle:              'bg-emerald-500',
};

const LS_KEY = 'notifications_last_seen';

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    return parseInt(localStorage.getItem(LS_KEY) ?? '0', 10);
  });
  const ref = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ data: AuditLog[]; total: number }>({
    queryKey: ['audit-notifications'],
    queryFn: async () => {
      const res = await fetch('/api/audit?limit=15');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    staleTime: 30_000,
  });

  const logs = data?.data ?? [];
  const unreadCount = logs.filter(
    (l) => new Date(l.created_at).getTime() > lastSeen
  ).length;

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('keydown', onKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    localStorage.setItem(LS_KEY, String(now));
    setLastSeen(now);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          open
            ? 'bg-[#19595b]/10 text-[#19595b] dark:bg-teal-500/20 dark:text-teal-300'
            : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
        )}
        aria-label="Open notifications"
        aria-expanded={open}
        title="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-dropdown absolute -right-2 sm:right-0 top-full mt-2 w-[calc(100vw-1.5rem)] sm:w-80 z-50 rounded-xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-border/40">
            {isLoading ? (
              <CardSpinner />
            ) : logs.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              logs.map((log) => {
                const isUnread = new Date(log.created_at).getTime() > lastSeen;
                const entityInfo = log.entity_type
                  ? `${log.entity_type.replace(/_/g, ' ')} ${log.entity_id?.slice(0, 6) ?? ''}…`
                  : null;
                return (
                  <div
                    key={log.id}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 transition-colors',
                      isUnread ? 'bg-[#19595b]/5' : 'hover:bg-black/[0.03]'
                    )}
                  >
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', ACTION_DOT[log.action] ?? 'bg-muted-foreground')} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground leading-snug">{actionLabel(log.action)}</p>
                      {entityInfo && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{entityInfo}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap mt-0.5">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
