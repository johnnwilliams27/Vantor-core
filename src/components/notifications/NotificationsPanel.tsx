'use client';
import { useRef, useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useNotifications, useMarkNotificationsRead, useClearNotifications } from '@/hooks/useNotifications';
import { useRouter } from 'next/navigation';
import type { Notification } from '@/types/notifications';

const CATEGORY_DOT: Record<string, string> = {
  treasury_ai: 'bg-sky-500',
  transactions: 'bg-amber-500',
  swaps: 'bg-blue-500',
  ramps: 'bg-green-500',
  bridges: 'bg-indigo-500',
  payments: 'bg-purple-500',
  yield: 'bg-teal-500',
  compliance: 'bg-rose-500',
  invoices: 'bg-orange-500',
  scheduled_ops: 'bg-cyan-500',
  wallets_accounts: 'bg-emerald-500',
  treasury_rules: 'bg-cyan-400',
  team: 'bg-violet-500',
  kyc_kyb: 'bg-pink-500',
  billing: 'bg-slate-500',
};

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const clearAll = useClearNotifications();

  const notifications = data?.data ?? [];
  const unreadCount = data?.unreadCount ?? 0;

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

  const handleMarkAllRead = useCallback(() => {
    markRead.mutate(undefined);
  }, [markRead]);

  const handleClickNotification = useCallback((notif: Notification) => {
    if (!notif.read) {
      markRead.mutate([notif.id]);
    }
    if (notif.link) {
      router.push(notif.link);
      setOpen(false);
    }
  }, [markRead, router]);

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
            <div className="flex items-center gap-3">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && unreadCount === 0 && (
                <button
                  onClick={() => clearAll.mutate()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-border/40">
            {isLoading ? (
              <CardSpinner />
            ) : notifications.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No notifications yet.</p>
            ) : (
              notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClickNotification(notif)}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 transition-colors w-full text-left',
                    !notif.read ? 'bg-[#19595b]/5' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                  )}
                >
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', CATEGORY_DOT[notif.category] ?? 'bg-muted-foreground')} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-snug">{notif.title}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{notif.body}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap mt-0.5">
                    {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
