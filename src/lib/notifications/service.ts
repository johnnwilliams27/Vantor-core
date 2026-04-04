import { createAdminClient } from '@/lib/supabase/admin';
import { sendNotificationEmail } from '@/lib/email/send';
import { getEventConfig } from './events';
import { hasRole } from '@/lib/auth/rbac';
import type { NotifyParams, NotificationPreference } from '@/types/notifications';
import type { UserRole } from '@/types/database';

export const NotificationService = {
  async notify(params: NotifyParams): Promise<void> {
    const {
      eventType,
      enterpriseId,
      title,
      body,
      link,
      metadata = {},
      actorId,
      additionalUserIds = [],
    } = params;

    // Dedup: skip if this action originated from a parent event
    if (metadata.origin === 'recommendation' || metadata.origin === 'scheduled_operation') {
      return;
    }

    const config = getEventConfig(eventType);
    if (!config) {
      console.warn(`[NotificationService] Unknown event type: ${eventType}`);
      return;
    }

    try {
      const supabase = createAdminClient();

      // 1. Resolve recipients by role
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id, email, full_name, role')
        .eq('enterprise_id', enterpriseId)
        .neq('is_app_admin', true);

      console.log(`[NotificationService] Event: ${eventType}, Enterprise: ${enterpriseId}, Users found: ${users?.length ?? 0}`);
      if (!users || users.length === 0) {
        console.warn('[NotificationService] No users found for enterprise');
        return;
      }

      const eligibleByRole = users.filter((u) =>
        config.defaultRoles.some((requiredRole) => hasRole(u.role as UserRole, requiredRole))
      );
      console.log(`[NotificationService] Eligible by role: ${eligibleByRole.length}, roles needed: ${config.defaultRoles.join(',')}, user roles: ${users.map(u => u.role).join(',')}`);

      const additionalUsers = users.filter(
        (u) => additionalUserIds.includes(u.id) && !eligibleByRole.some((e) => e.id === u.id)
      );

      const recipients = [...eligibleByRole, ...additionalUsers];

      if (recipients.length === 0) {
        console.warn('[NotificationService] No recipients after filtering');
        return;
      }
      console.log(`[NotificationService] Sending to ${recipients.length} recipients: ${recipients.map(r => r.email).join(', ')}`);

      // 2. Fetch preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('enterprise_id', enterpriseId)
        .eq('event_type', eventType)
        .in('user_id', recipients.map((r) => r.id));

      const prefMap = new Map<string, NotificationPreference>();
      (prefs ?? []).forEach((p) => prefMap.set(p.user_id, p as NotificationPreference));

      // 3. Insert in-app notifications
      const inAppRecipients = recipients.filter((r) => {
        const pref = prefMap.get(r.id);
        return pref ? pref.in_app_enabled : true;
      });

      if (inAppRecipients.length > 0) {
        const rows = inAppRecipients.map((r) => ({
          enterprise_id: enterpriseId,
          user_id: r.id,
          event_type: eventType,
          category: config.category,
          title,
          body,
          metadata: { ...metadata, _emailHtml: undefined, _emailSubject: undefined },
          link: link ?? null,
          read: false,
          emailed: false,
          slacked: false,
        }));

        console.log(`[NotificationService] Inserting ${rows.length} in-app notifications`);
        const { error: insertErr } = await supabase.from('notifications').insert(rows);
        if (insertErr) {
          console.error('[NotificationService] Insert failed:', insertErr.message, insertErr);
        } else {
          console.log('[NotificationService] Insert succeeded');
        }
      }

      // 4. Send emails (fire-and-forget)
      const emailRecipients = recipients.filter((r) => {
        const pref = prefMap.get(r.id);
        return pref ? pref.email_enabled : true;
      });

      if (emailRecipients.length > 0 && metadata._emailHtml && metadata._emailSubject) {
        for (const recipient of emailRecipients) {
          sendNotificationEmail({
            to: recipient.email,
            subject: metadata._emailSubject as string,
            html: metadata._emailHtml as string,
          }).catch((err) => {
            console.error(`[NotificationService] Email failed for ${recipient.email}:`, err);
          });
        }
      }

      // 5. Send Slack (fire-and-forget)
      const slackRecipients = recipients.filter((r) => {
        const pref = prefMap.get(r.id);
        return pref ? pref.slack_enabled : true;
      });

      if (slackRecipients.length > 0) {
        try {
          const { data: slackIntegration } = await supabase
            .from('slack_integrations')
            .select('channel_id, credentials')
            .eq('enterprise_id', enterpriseId)
            .eq('is_active', true)
            .maybeSingle();

          if (slackIntegration && metadata._slackFn) {
            const fn = metadata._slackFn as () => Promise<void>;
            fn().catch((err: unknown) => {
              console.error('[NotificationService] Slack failed:', err);
            });
          }
        } catch {
          // Silently ignore Slack errors
        }
      }
    } catch (err) {
      console.error('[NotificationService] Unexpected error:', err);
    }
  },
};
