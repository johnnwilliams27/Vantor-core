'use client';
import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { useNotificationPreferences, useUpdateNotificationPreference } from '@/hooks/useNotifications';
import { EVENT_CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/notifications/events';
import { hasRole } from '@/lib/auth/rbac';
import { ChevronDown, Bell, Mail, MessageSquare } from 'lucide-react';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/database';
import type { NotificationEventType, NotificationCategory } from '@/types/notifications';

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-[#19595b]' : 'bg-gray-300 dark:bg-gray-600',
        disabled && 'opacity-40 cursor-not-allowed'
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  );
}

function CategorySection({
  category,
  userRole,
  preferences,
  slackConnected,
  onToggle,
}: {
  category: NotificationCategory;
  userRole: UserRole;
  preferences: Map<string, { in_app: boolean; email: boolean; slack: boolean }>;
  slackConnected: boolean;
  onToggle: (eventType: NotificationEventType, channel: 'in_app' | 'email' | 'slack', value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const events = EVENT_CATALOG.filter(
    (e) => e.category === category && e.defaultRoles.some((r) => hasRole(userRole, r))
  );

  if (events.length === 0) return null;

  const allInApp = events.every((e) => preferences.get(e.eventType)?.in_app ?? true);
  const allEmail = events.every((e) => preferences.get(e.eventType)?.email ?? true);
  const allSlack = events.every((e) => preferences.get(e.eventType)?.slack ?? true);

  const handleBulkToggle = (channel: 'in_app' | 'email' | 'slack') => {
    const allOn = channel === 'in_app' ? allInApp : channel === 'email' ? allEmail : allSlack;
    events.forEach((e) => onToggle(e.eventType, channel, !allOn));
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="text-sm font-semibold text-foreground">{CATEGORY_LABELS[category]}</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div>
          <div className="flex items-center px-4 py-2.5 border-b-2 border-border bg-muted/30">
            <span className="flex-1 text-xs font-semibold text-foreground uppercase tracking-wide">Toggle all</span>
            <div className="flex items-center gap-6">
              <div className="w-14 flex justify-center">
                <Toggle checked={allInApp} onChange={() => handleBulkToggle('in_app')} />
              </div>
              <div className="w-14 flex justify-center">
                <Toggle checked={allEmail} onChange={() => handleBulkToggle('email')} />
              </div>
              <div className="w-14 flex justify-center">
                <Toggle checked={allSlack} onChange={() => handleBulkToggle('slack')} disabled={!slackConnected} />
              </div>
            </div>
          </div>

          {events.map((event) => {
            const pref = preferences.get(event.eventType);
            const inApp = pref?.in_app ?? true;
            const email = pref?.email ?? true;
            const slack = pref?.slack ?? true;

            return (
              <div
                key={event.eventType}
                className="flex items-center px-4 py-2.5 border-b border-border/30 last:border-b-0 hover:bg-muted/20 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{event.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{event.description}</p>
                </div>
                <div className="flex items-center gap-6">
                  <div className="w-14 flex justify-center">
                    <Toggle checked={inApp} onChange={(v) => onToggle(event.eventType, 'in_app', v)} />
                  </div>
                  <div className="w-14 flex justify-center">
                    <Toggle checked={email} onChange={(v) => onToggle(event.eventType, 'email', v)} />
                  </div>
                  <div className="w-14 flex justify-center">
                    <Toggle checked={slack} onChange={(v) => onToggle(event.eventType, 'slack', v)} disabled={!slackConnected} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function NotificationsSettingsPage() {
  const { data: session } = useSession();
  const { data: prefsData } = useNotificationPreferences();
  const updatePref = useUpdateNotificationPreference();

  const userRole = (session?.user?.role as UserRole) ?? 'auditor';

  const { data: slackData } = useQuery<{ connected: boolean }>({
    queryKey: ['slack-status'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/slack/status');
      if (!res.ok) return { connected: false };
      return res.json();
    },
  });
  const slackConnected = slackData?.connected ?? false;

  // Optimistic overrides — keyed by event_type, merged on top of server data
  const [overrides, setOverrides] = useState<Record<string, { in_app: boolean; email: boolean; slack: boolean }>>({});

  // Build preferences map: server data + optimistic overrides
  const prefMap = new Map<string, { in_app: boolean; email: boolean; slack: boolean }>();
  (prefsData?.data ?? []).forEach((p) => {
    prefMap.set(p.event_type, {
      in_app: p.in_app_enabled,
      email: p.email_enabled,
      slack: p.slack_enabled,
    });
  });
  // Apply overrides on top
  for (const [key, val] of Object.entries(overrides)) {
    prefMap.set(key, val);
  }

  const handleToggle = useCallback((eventType: NotificationEventType, channel: 'in_app' | 'email' | 'slack', value: boolean) => {
    setOverrides((prev) => {
      const existing = prev[eventType] ?? prefMap.get(eventType) ?? { in_app: true, email: true, slack: true };
      const newPref = {
        in_app: channel === 'in_app' ? value : existing.in_app,
        email: channel === 'email' ? value : existing.email,
        slack: channel === 'slack' ? value : existing.slack,
      };

      updatePref.mutate({
        event_type: eventType,
        in_app_enabled: newPref.in_app,
        email_enabled: newPref.email,
        slack_enabled: newPref.slack,
      });

      return { ...prev, [eventType]: newPref };
    });
  }, [prefMap, updatePref]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notification Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose how you want to be notified for each event type.</p>
      </div>

      <div className="flex items-center px-4 py-2">
        <span className="flex-1" />
        <div className="flex items-center gap-6">
          <div className="w-14 flex flex-col items-center gap-1">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">In-App</span>
          </div>
          <div className="w-14 flex flex-col items-center gap-1">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">Email</span>
          </div>
          <div className="w-14 flex flex-col items-center gap-1">
            <span className="relative">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              {!slackConnected && (
                <span className="absolute -top-2 -right-4">
                  <InfoTooltip content="Connect Slack in Settings > Integrations to enable Slack notifications." />
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">Slack</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {CATEGORY_ORDER.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            userRole={userRole}
            preferences={prefMap}
            slackConnected={slackConnected}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}
