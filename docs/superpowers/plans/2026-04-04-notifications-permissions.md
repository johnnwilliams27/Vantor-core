# Notifications, Email Alerts & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified notification system (in-app, email, Slack) for 38 event types, a notifications settings page, expanded permissions matrix, RBAC fixes, and AI recommendation email deep links.

**Architecture:** Centralized `NotificationService` called from API routes, with DB-backed preferences and three delivery channels. New `notifications` and `notification_preferences` tables. Bell icon switches from audit logs to notifications table.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres), Resend (email), existing Slack integration, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-04-04-notifications-permissions-design.md`

---

## File Structure

### New Files
```
supabase/migrations/0023_notifications.sql          — notifications + notification_preferences tables
src/lib/notifications/events.ts                      — event type catalog, categories, default recipients
src/lib/notifications/service.ts                     — NotificationService.notify() core logic
src/lib/notifications/email-templates.ts             — HTML email builders (base layout + 4 tiers)
src/lib/notifications/recommendation-email.ts        — rich AI recommendation email template
src/app/api/notifications/route.ts                   — GET notifications, PATCH mark-read
src/app/api/notifications/preferences/route.ts       — GET/PUT notification preferences
src/app/(app)/settings/notifications/page.tsx         — Settings > Notifications UI
src/hooks/useNotifications.ts                        — TanStack Query hooks for notifications + preferences
src/app/dev/email-previews/page.tsx                  — Dev-only email preview page
src/types/notifications.ts                           — TypeScript types for notifications
```

### Modified Files
```
src/lib/auth/rbac.ts                                 — RBAC route updates (reporting→accountant, compliance→auditor, add notifications route)
src/components/layout/Sidebar.tsx                    — Add Notifications to settings nav, update minRole for reporting/compliance
src/components/notifications/NotificationsPanel.tsx  — Switch from audit logs to notifications table
src/app/(app)/settings/accounts/page.tsx             — Expand permissions matrix to 23 rows
src/app/api/treasury/recommendations/generate/route.ts — Add NotificationService.notify() call
src/app/api/treasury/recommendations/[id]/approve/route.ts — Add notify call
src/app/api/treasury/recommendations/[id]/reject/route.ts — Add notify call
src/components/treasury/TreasuryPageClient.tsx       — Handle ?reviewRec= deep link query param
src/lib/email/send.ts                               — Add sendNotificationEmail with notifications@ sender
src/types/database.ts                                — Add Notification and NotificationPreference types
```

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0023_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  link TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  emailed BOOLEAN NOT NULL DEFAULT false,
  slacked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_notifications_enterprise_event ON notifications(enterprise_id, event_type);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users update own notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can insert notifications for any user
CREATE POLICY "service insert notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- Notification preferences table
CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  slack_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_type)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own preferences"
  ON notification_preferences FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users manage own preferences"
  ON notification_preferences FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role can read all preferences (for sending notifications)
CREATE POLICY "service read preferences"
  ON notification_preferences FOR SELECT
  USING (true);
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push` or apply via Supabase dashboard.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0023_notifications.sql
git commit -m "feat: add notifications and notification_preferences tables"
```

---

### Task 2: TypeScript Types

**Files:**
- Create: `src/types/notifications.ts`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Create notification types**

Create `src/types/notifications.ts`:

```typescript
import type { UserRole } from './database';

export type NotificationCategory =
  | 'treasury_ai'
  | 'transactions'
  | 'swaps'
  | 'ramps'
  | 'bridges'
  | 'payments'
  | 'yield'
  | 'compliance'
  | 'invoices'
  | 'scheduled_ops'
  | 'wallets_accounts'
  | 'treasury_rules'
  | 'team'
  | 'kyc_kyb'
  | 'billing';

export type NotificationEventType =
  // Treasury AI
  | 'recommendation_pending'
  | 'recommendation_auto_executed'
  | 'recommendation_approved'
  | 'recommendation_rejected'
  | 'recommendation_expired'
  // Transactions
  | 'transfer_completed'
  | 'transfer_scheduled'
  // Swaps
  | 'swap_completed'
  // Ramps
  | 'onramp_completed'
  | 'offramp_completed'
  // Bridges
  | 'bridge_completed'
  // Payments
  | 'payment_sent'
  | 'payment_received'
  // Yield
  | 'yield_deposit_confirmed'
  | 'yield_withdrawal_confirmed'
  // Compliance
  | 'sanctions_alert'
  | 'travel_rule_notification'
  // Invoices
  | 'invoice_synced'
  | 'invoice_overdue'
  // Scheduled Ops
  | 'scheduled_swap_executed'
  | 'scheduled_bridge_executed'
  | 'scheduled_ramp_executed'
  | 'scheduled_operation_flagged'
  | 'scheduled_operation_failed'
  // Wallets & Accounts
  | 'wallet_connected'
  | 'wallet_disconnected'
  | 'bank_account_linked'
  | 'bank_account_removed'
  | 'erp_connected'
  | 'erp_disconnected'
  // Treasury Rules
  | 'treasury_rule_created'
  | 'treasury_rule_updated'
  // Team
  | 'member_invited'
  | 'member_removed'
  | 'role_changed'
  // KYC/KYB
  | 'kyc_status_changed'
  | 'kyb_status_changed'
  // Billing
  | 'payment_failed'
  | 'subscription_changed';

export interface Notification {
  id: string;
  enterprise_id: string;
  user_id: string;
  event_type: NotificationEventType;
  category: NotificationCategory;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  link: string | null;
  read: boolean;
  emailed: boolean;
  slacked: boolean;
  created_at: string;
}

export interface NotificationPreference {
  id: string;
  user_id: string;
  enterprise_id: string;
  event_type: NotificationEventType;
  in_app_enabled: boolean;
  email_enabled: boolean;
  slack_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventConfig {
  eventType: NotificationEventType;
  category: NotificationCategory;
  label: string;
  description: string;
  defaultRoles: UserRole[];
  /** Additional user IDs to notify (e.g., KYC subject user) */
  additionalRecipientKey?: string;
}

export interface NotifyParams {
  eventType: NotificationEventType;
  enterpriseId: string;
  title: string;
  body: string;
  link?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  /** Additional specific user IDs to include */
  additionalUserIds?: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/notifications.ts
git commit -m "feat: add notification TypeScript types"
```

---

### Task 3: Event Catalog

**Files:**
- Create: `src/lib/notifications/events.ts`

- [ ] **Step 1: Create the event catalog**

Create `src/lib/notifications/events.ts`:

```typescript
import type { EventConfig, NotificationCategory } from '@/types/notifications';

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  treasury_ai: 'Treasury AI',
  transactions: 'Transactions',
  swaps: 'Swaps',
  ramps: 'Ramps',
  bridges: 'Bridges',
  payments: 'Payments',
  yield: 'Yield',
  compliance: 'Compliance',
  invoices: 'Invoices',
  scheduled_ops: 'Scheduled Operations',
  wallets_accounts: 'Wallets & Accounts',
  treasury_rules: 'Treasury Rules',
  team: 'Team',
  kyc_kyb: 'KYC / KYB',
  billing: 'Billing',
};

/** Order categories appear in the Settings > Notifications UI */
export const CATEGORY_ORDER: NotificationCategory[] = [
  'treasury_ai',
  'transactions',
  'swaps',
  'ramps',
  'bridges',
  'payments',
  'yield',
  'compliance',
  'invoices',
  'scheduled_ops',
  'wallets_accounts',
  'treasury_rules',
  'team',
  'kyc_kyb',
  'billing',
];

export const EVENT_CATALOG: EventConfig[] = [
  // Treasury AI
  { eventType: 'recommendation_pending', category: 'treasury_ai', label: 'Recommendation Pending Approval', description: 'New AI recommendation needs approval', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_auto_executed', category: 'treasury_ai', label: 'Recommendation Auto-Executed', description: 'AI recommendation auto-executed below threshold', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_approved', category: 'treasury_ai', label: 'Recommendation Approved', description: 'AI recommendation was approved and executed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_rejected', category: 'treasury_ai', label: 'Recommendation Rejected', description: 'AI recommendation was rejected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'recommendation_expired', category: 'treasury_ai', label: 'Recommendation Expired', description: 'AI recommendation expired without action', defaultRoles: ['treasury_manager', 'accountant'] },

  // Transactions
  { eventType: 'transfer_completed', category: 'transactions', label: 'Transfer Completed', description: 'Crypto transfer was executed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'transfer_scheduled', category: 'transactions', label: 'Transfer Scheduled', description: 'Transfer was scheduled for future execution', defaultRoles: ['treasury_manager', 'accountant'] },

  // Swaps
  { eventType: 'swap_completed', category: 'swaps', label: 'Swap Completed', description: 'Token swap was executed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Ramps
  { eventType: 'onramp_completed', category: 'ramps', label: 'On-Ramp Completed', description: 'Fiat to crypto conversion completed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'offramp_completed', category: 'ramps', label: 'Off-Ramp Completed', description: 'Crypto to fiat conversion completed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Bridges
  { eventType: 'bridge_completed', category: 'bridges', label: 'Bridge Completed', description: 'Cross-chain bridge was executed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Payments
  { eventType: 'payment_sent', category: 'payments', label: 'Payment Sent', description: 'Fiat payment was sent', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'payment_received', category: 'payments', label: 'Payment Received', description: 'Fiat payment was received', defaultRoles: ['treasury_manager', 'accountant'] },

  // Yield
  { eventType: 'yield_deposit_confirmed', category: 'yield', label: 'Yield Deposit Confirmed', description: 'Yield protocol deposit was confirmed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'yield_withdrawal_confirmed', category: 'yield', label: 'Yield Withdrawal Confirmed', description: 'Yield protocol withdrawal was confirmed', defaultRoles: ['treasury_manager', 'accountant'] },

  // Compliance
  { eventType: 'sanctions_alert', category: 'compliance', label: 'Sanctions Alert', description: 'Sanctions screening hit detected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'travel_rule_notification', category: 'compliance', label: 'Travel Rule Notification', description: 'Travel rule was triggered', defaultRoles: ['treasury_manager', 'accountant'] },

  // Invoices
  { eventType: 'invoice_synced', category: 'invoices', label: 'Invoice Synced', description: 'Invoice was synced from ERP', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'invoice_overdue', category: 'invoices', label: 'Invoice Overdue', description: 'Invoice is past due date', defaultRoles: ['treasury_manager', 'accountant'] },

  // Scheduled Ops
  { eventType: 'scheduled_swap_executed', category: 'scheduled_ops', label: 'Scheduled Swap Executed', description: 'Scheduled swap completed within tolerance', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_bridge_executed', category: 'scheduled_ops', label: 'Scheduled Bridge Executed', description: 'Scheduled bridge completed within tolerance', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_ramp_executed', category: 'scheduled_ops', label: 'Scheduled Ramp Executed', description: 'Scheduled ramp completed within tolerance', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_operation_flagged', category: 'scheduled_ops', label: 'Scheduled Op Flagged', description: 'Rate deviation exceeded tolerance, needs authorization', defaultRoles: ['treasury_manager'] },
  { eventType: 'scheduled_operation_failed', category: 'scheduled_ops', label: 'Scheduled Op Failed', description: 'Scheduled operation failed during execution', defaultRoles: ['treasury_manager'] },

  // Wallets & Accounts
  { eventType: 'wallet_connected', category: 'wallets_accounts', label: 'Wallet Connected', description: 'A wallet was connected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'wallet_disconnected', category: 'wallets_accounts', label: 'Wallet Disconnected', description: 'A wallet was disconnected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'bank_account_linked', category: 'wallets_accounts', label: 'Bank Account Linked', description: 'A bank account was linked', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'bank_account_removed', category: 'wallets_accounts', label: 'Bank Account Removed', description: 'A bank account was removed', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'erp_connected', category: 'wallets_accounts', label: 'ERP Connected', description: 'An ERP system was connected', defaultRoles: ['treasury_manager', 'accountant'] },
  { eventType: 'erp_disconnected', category: 'wallets_accounts', label: 'ERP Disconnected', description: 'An ERP system was disconnected', defaultRoles: ['treasury_manager', 'accountant'] },

  // Treasury Rules
  { eventType: 'treasury_rule_created', category: 'treasury_rules', label: 'Treasury Rule Created', description: 'A new treasury rule was created', defaultRoles: ['treasury_manager'] },
  { eventType: 'treasury_rule_updated', category: 'treasury_rules', label: 'Treasury Rule Updated', description: 'A treasury rule was updated', defaultRoles: ['treasury_manager'] },

  // Team
  { eventType: 'member_invited', category: 'team', label: 'Member Invited', description: 'A new team member was invited', defaultRoles: ['treasury_manager'] },
  { eventType: 'member_removed', category: 'team', label: 'Member Removed', description: 'A team member was removed', defaultRoles: ['treasury_manager'] },
  { eventType: 'role_changed', category: 'team', label: 'Role Changed', description: "A team member's role was changed", defaultRoles: ['treasury_manager'] },

  // KYC/KYB
  { eventType: 'kyc_status_changed', category: 'kyc_kyb', label: 'KYC Status Changed', description: 'KYC verification status updated', defaultRoles: ['treasury_manager'], additionalRecipientKey: 'subjectUserId' },
  { eventType: 'kyb_status_changed', category: 'kyc_kyb', label: 'KYB Status Changed', description: 'KYB verification status updated', defaultRoles: ['treasury_manager'] },

  // Billing
  { eventType: 'payment_failed', category: 'billing', label: 'Payment Failed', description: 'Billing payment failed', defaultRoles: ['treasury_manager'] },
  { eventType: 'subscription_changed', category: 'billing', label: 'Subscription Changed', description: 'Subscription plan was changed', defaultRoles: ['treasury_manager'] },
];

export function getEventConfig(eventType: string): EventConfig | undefined {
  return EVENT_CATALOG.find((e) => e.eventType === eventType);
}

export function getEventsByCategory(category: NotificationCategory): EventConfig[] {
  return EVENT_CATALOG.filter((e) => e.category === category);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/notifications/events.ts
git commit -m "feat: add notification event catalog with 38 event types"
```

---

### Task 4: Email Templates

**Files:**
- Create: `src/lib/notifications/email-templates.ts`
- Create: `src/lib/notifications/recommendation-email.ts`

- [ ] **Step 1: Create base email layout and standard templates**

Create `src/lib/notifications/email-templates.ts`:

```typescript
/**
 * Shared email layout and standard notification email templates.
 * All templates use inline CSS for email client compatibility.
 */

const BRAND_COLOR = '#19595b';
const BRAND_HOVER = '#134849';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.vantor.xyz';

/** Wrap content in the standard Vantor email layout */
export function emailLayout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:${BRAND_COLOR};padding:28px 32px;text-align:center">
      <img src="https://vantor.xyz/logo-dark.png" alt="Vantor" style="height:40px" />
    </div>
    ${content}
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">&copy; 2026 Vantor Treasury, Inc. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

export function ctaButton(label: string, href: string, variant: 'primary' | 'outline' = 'primary'): string {
  const fullHref = href.startsWith('http') ? href : `${APP_URL}${href}`;
  if (variant === 'outline') {
    return `<a href="${fullHref}" style="display:inline-block;padding:12px 24px;border:2px solid ${BRAND_COLOR};color:${BRAND_COLOR};text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${label}</a>`;
  }
  return `<a href="${fullHref}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${label}</a>`;
}

/** Format USD amount */
function fmtUsd(v: string | number | null): string {
  if (v === null || v === undefined) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(v));
}

/** Capitalize first letter */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Tier 2: Action notification (standard format)
 * Used for transfers, swaps, ramps, bridges, payments, yield
 */
export function actionNotificationEmail(params: {
  title: string;
  details: { label: string; value: string }[];
  ctaLabel: string;
  ctaHref: string;
  scheduledDeviation?: { toleranceBps: number; actualBps: number };
}): string {
  const detailRows = params.details
    .map((d) => `
      <tr>
        <td style="padding:6px 12px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0">${d.label}</td>
        <td style="padding:6px 12px;font-size:13px;font-weight:600;color:#111;border-bottom:1px solid #f0f0f0;text-align:right">${d.value}</td>
      </tr>`)
    .join('');

  const deviationHtml = params.scheduledDeviation
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b33;border-radius:8px;padding:12px;margin-top:16px;font-size:13px;color:#92400e">
        Rate deviation: ${params.scheduledDeviation.actualBps}bps (tolerance: ${params.scheduledDeviation.toleranceBps}bps)
      </div>`
    : '';

  return emailLayout(`
    <div style="padding:32px">
      <h1 style="font-size:20px;color:#111;margin:0 0 20px">${params.title}</h1>
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;overflow:hidden">
        ${detailRows}
      </table>
      ${deviationHtml}
      <div style="text-align:center;margin-top:24px">
        ${ctaButton(params.ctaLabel, params.ctaHref)}
      </div>
    </div>`);
}

/**
 * Tier 3: Alert email (minimal format)
 * Used for compliance, invoice overdue, scheduled op failed, billing failed
 */
export function alertEmail(params: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
  severity?: 'warning' | 'error';
}): string {
  const severityColor = params.severity === 'error' ? '#dc2626' : '#f59e0b';
  const severityBg = params.severity === 'error' ? '#fef2f2' : '#fffbeb';

  return emailLayout(`
    <div style="padding:32px">
      <div style="background:${severityBg};border-left:4px solid ${severityColor};border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px">
        <h1 style="font-size:18px;color:#111;margin:0 0 8px">${params.title}</h1>
        <p style="color:#666;font-size:14px;margin:0;line-height:1.5">${params.description}</p>
      </div>
      <div style="text-align:center">
        ${ctaButton(params.ctaLabel, params.ctaHref)}
      </div>
    </div>`);
}

/**
 * Tier 4: Informational email (simple format)
 * Used for team changes, wallet/account events, treasury rules, KYC/KYB
 */
export function infoEmail(params: {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}): string {
  return emailLayout(`
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:20px;color:#111;margin:0 0 12px">${params.title}</h1>
      <p style="color:#666;font-size:14px;margin:0 0 24px;line-height:1.5">${params.description}</p>
      ${ctaButton(params.ctaLabel, params.ctaHref)}
    </div>`);
}

export { fmtUsd, cap, APP_URL };
```

- [ ] **Step 2: Create AI recommendation email template**

Create `src/lib/notifications/recommendation-email.ts`:

```typescript
import { emailLayout, ctaButton, fmtUsd, APP_URL } from './email-templates';

const ACTION_LABELS: Record<string, string> = {
  onramp: 'On-Ramp',
  offramp: 'Off-Ramp',
  no_action: 'No Action Needed',
};

const ACTION_COLORS: Record<string, string> = {
  onramp: '#16a34a',
  offramp: '#2563eb',
  no_action: '#6b7280',
};

interface RecommendationEmailParams {
  id: string;
  action: string;
  recommendedAmountUsd: string | number | null;
  totalBankBalanceUsd: string | number;
  obligationsInWindowUsd: string | number;
  safetyBufferTargetUsd: string | number;
  obligationLookaheadDays: number;
  aiReasoning: string;
  stablecoinToken: string | null;
  stablecoinChain: string | null;
  bankLabel: string;
  walletLabel: string;
  status: string;
  expiresAt?: string;
}

export function recommendationEmailHtml(params: RecommendationEmailParams): string {
  const actionLabel = ACTION_LABELS[params.action] ?? params.action;
  const actionColor = ACTION_COLORS[params.action] ?? '#6b7280';
  const isPending = params.status === 'pending_approval';
  const chainLabel = params.stablecoinChain
    ? params.stablecoinChain.charAt(0).toUpperCase() + params.stablecoinChain.slice(1)
    : '';

  // Movement flow
  let movementHtml = '';
  if (params.action !== 'no_action' && params.stablecoinToken) {
    const from = params.action === 'offramp'
      ? `${params.stablecoinToken} on ${chainLabel} (${params.walletLabel})`
      : `USD (${params.bankLabel})`;
    const to = params.action === 'offramp'
      ? `USD (${params.bankLabel})`
      : `${params.stablecoinToken} on ${chainLabel} (${params.walletLabel})`;
    movementHtml = `
      <div style="background:#f0faf9;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:13px">
        <span style="color:#111;font-weight:600">${from}</span>
        <span style="color:#999;margin:0 8px">&rarr;</span>
        <span style="color:#111;font-weight:600">${to}</span>
      </div>`;
  }

  // Expiration note
  const expirationHtml = isPending && params.expiresAt
    ? `<p style="color:#f59e0b;font-size:12px;margin:16px 0 0;text-align:center">This recommendation expires in 24 hours.</p>`
    : '';

  // CTA buttons
  const ctaHtml = isPending
    ? `<div style="text-align:center;margin-top:24px">
        ${ctaButton('Review & Approve', `/treasury?reviewRec=${params.id}`)}
        <span style="display:inline-block;width:12px"></span>
        ${ctaButton('Review & Reject', `/treasury?reviewRec=${params.id}`, 'outline')}
      </div>`
    : `<div style="text-align:center;margin-top:24px">
        ${ctaButton('View Details', '/treasury')}
      </div>`;

  // Status label for non-pending
  const statusLabels: Record<string, string> = {
    pending_approval: 'Pending Approval',
    auto_executed: 'Auto-Executed',
    approved: 'Approved',
    executed: 'Executed',
    rejected: 'Rejected',
    expired: 'Expired',
  };
  const statusLabel = statusLabels[params.status] ?? params.status;

  return emailLayout(`
    <div style="padding:32px">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <div>
          <span style="color:${actionColor};font-weight:700;font-size:16px">${actionLabel}</span>
          ${params.recommendedAmountUsd ? `<span style="font-size:20px;font-weight:700;color:#111;margin-left:8px">${fmtUsd(params.recommendedAmountUsd)}</span>` : ''}
        </div>
        <span style="background:#f0f0f0;color:#666;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600">${statusLabel}</span>
      </div>

      <!-- Context Grid -->
      <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;overflow:hidden">
        <tr>
          <td style="padding:12px 16px;text-align:center;width:33%">
            <div style="color:#999;font-size:11px;margin-bottom:4px">Fiat Balance</div>
            <div style="font-size:14px;font-weight:700;color:#111">${fmtUsd(params.totalBankBalanceUsd)}</div>
          </td>
          <td style="padding:12px 16px;text-align:center;width:33%;border-left:1px solid #eee;border-right:1px solid #eee">
            <div style="color:#999;font-size:11px;margin-bottom:4px">Obligations (${params.obligationLookaheadDays}d)</div>
            <div style="font-size:14px;font-weight:700;color:#111">${fmtUsd(params.obligationsInWindowUsd)}</div>
          </td>
          <td style="padding:12px 16px;text-align:center;width:33%">
            <div style="color:#999;font-size:11px;margin-bottom:4px">Safety Target</div>
            <div style="font-size:14px;font-weight:700;color:#111">${fmtUsd(params.safetyBufferTargetUsd)}</div>
          </td>
        </tr>
      </table>

      <!-- AI Reasoning -->
      <div style="border-left:3px solid ${actionColor};padding:12px 16px;margin-top:16px;font-size:13px;color:#333;line-height:1.6;white-space:pre-line">${params.aiReasoning}</div>

      ${movementHtml}
      ${ctaHtml}
      ${expirationHtml}
    </div>`);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications/email-templates.ts src/lib/notifications/recommendation-email.ts
git commit -m "feat: add notification email templates (4 tiers + recommendation)"
```

---

### Task 5: Email Send Update

**Files:**
- Modify: `src/lib/email/send.ts`

- [ ] **Step 1: Add notification email sender**

Add a `sendNotificationEmail` function that uses `notifications@vantor.xyz` as the sender. Keep the existing `sendEmail` function unchanged for billing/auth emails.

Add after the existing `sendEmail` function in `src/lib/email/send.ts`:

```typescript
export async function sendNotificationEmail(params: {
  to: string;
  subject: string;
  html: string;
}) {
  if (USE_MOCK) {
    console.log('[MOCK NOTIFICATION EMAIL]', { to: params.to, subject: params.subject });
    return { id: 'mock-' + Date.now() };
  }

  const result = await getResend().emails.send({
    from: 'Vantor <notifications@vantor.xyz>',
    to: params.to,
    subject: params.subject,
    html: params.html,
  });

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/email/send.ts
git commit -m "feat: add sendNotificationEmail with notifications@ sender"
```

---

### Task 6: Notification Service

**Files:**
- Create: `src/lib/notifications/service.ts`

- [ ] **Step 1: Implement the core notification service**

Create `src/lib/notifications/service.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { sendNotificationEmail } from '@/lib/email/send';
import { getEventConfig } from './events';
import { hasRole } from '@/lib/auth/rbac';
import type { NotifyParams, NotificationPreference } from '@/types/notifications';
import type { UserRole } from '@/types/database';

export const NotificationService = {
  /**
   * Send notifications for an event to all eligible recipients.
   * Non-blocking: email/Slack failures are logged, never propagated.
   */
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

    // Check origin-based dedup: if this action came from a recommendation or scheduled op, skip
    if (metadata.origin === 'recommendation' || metadata.origin === 'scheduled_operation') {
      return;
    }

    const config = getEventConfig(eventType);
    if (!config) {
      console.warn(`[NotificationService] Unknown event type: ${eventType}`);
      return;
    }

    const supabase = createAdminClient();

    // 1. Resolve recipients by role
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role')
      .eq('enterprise_id', enterpriseId)
      .not('is_app_admin', 'eq', true);

    if (!users || users.length === 0) return;

    // Filter to users whose role is in the defaultRoles list
    const eligibleByRole = users.filter((u) =>
      config.defaultRoles.some((requiredRole) => hasRole(u.role as UserRole, requiredRole))
    );

    // Add any additional specific user IDs (e.g., KYC subject user)
    const additionalUsers = users.filter(
      (u) => additionalUserIds.includes(u.id) && !eligibleByRole.some((e) => e.id === u.id)
    );

    const allRecipients = [...eligibleByRole, ...additionalUsers];

    // Exclude the actor who triggered the event
    const recipients = actorId
      ? allRecipients.filter((u) => u.id !== actorId)
      : allRecipients;

    if (recipients.length === 0) return;

    // 2. Fetch preferences for all recipients
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .eq('event_type', eventType)
      .in('user_id', recipients.map((r) => r.id));

    const prefMap = new Map<string, NotificationPreference>();
    (prefs ?? []).forEach((p) => prefMap.set(p.user_id, p as NotificationPreference));

    // 3. Build notification rows for in-app-enabled recipients
    const inAppRecipients = recipients.filter((r) => {
      const pref = prefMap.get(r.id);
      return pref ? pref.in_app_enabled : true; // default: enabled
    });

    if (inAppRecipients.length > 0) {
      const rows = inAppRecipients.map((r) => ({
        enterprise_id: enterpriseId,
        user_id: r.id,
        event_type: eventType,
        category: config.category,
        title,
        body,
        metadata,
        link: link ?? null,
        read: false,
        emailed: false,
        slacked: false,
      }));

      const { error: insertErr } = await supabase.from('notifications').insert(rows);
      if (insertErr) {
        console.error('[NotificationService] Failed to insert notifications:', insertErr.message);
      }
    }

    // 4. Send emails (fire-and-forget)
    const emailRecipients = recipients.filter((r) => {
      const pref = prefMap.get(r.id);
      return pref ? pref.email_enabled : true; // default: enabled
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

      // Mark emailed on the notification rows
      if (inAppRecipients.length > 0) {
        const emailedIds = emailRecipients.map((r) => r.id);
        await supabase
          .from('notifications')
          .update({ emailed: true })
          .eq('enterprise_id', enterpriseId)
          .eq('event_type', eventType)
          .in('user_id', emailedIds)
          .order('created_at', { ascending: false })
          .limit(emailedIds.length);
      }
    }

    // 5. Send Slack (fire-and-forget) — only if enterprise has Slack connected
    const slackRecipients = recipients.filter((r) => {
      const pref = prefMap.get(r.id);
      return pref ? pref.slack_enabled : true; // default: enabled
    });

    if (slackRecipients.length > 0 && metadata._slackMessage) {
      // Slack is enterprise-wide (one channel), so just check if any recipient wants it
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
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/notifications/service.ts
git commit -m "feat: add NotificationService with in-app, email, and Slack delivery"
```

---

### Task 7: Notifications API Routes

**Files:**
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/preferences/route.ts`

- [ ] **Step 1: Create notifications GET/PATCH endpoint**

Create `src/app/api/notifications/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10);

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Unread count
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('read', false);

  return NextResponse.json({ data, unreadCount: count ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const body = await req.json();

  if (body.ids && Array.isArray(body.ids)) {
    // Mark specific notifications as read
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .in('id', body.ids);
  } else {
    // Mark all as read
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .eq('read', false);
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Create notification preferences endpoint**

Create `src/app/api/notifications/preferences/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();
  const body = await req.json();

  const { event_type, in_app_enabled, email_enabled, slack_enabled } = body;

  if (!event_type) {
    return NextResponse.json({ error: 'event_type is required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: session.user.id,
        enterprise_id: enterpriseId,
        event_type,
        in_app_enabled: in_app_enabled ?? true,
        email_enabled: email_enabled ?? true,
        slack_enabled: slack_enabled ?? true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,event_type' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/notifications/route.ts src/app/api/notifications/preferences/route.ts
git commit -m "feat: add notifications and preferences API endpoints"
```

---

### Task 8: Notification Hooks

**Files:**
- Create: `src/hooks/useNotifications.ts`

- [ ] **Step 1: Create TanStack Query hooks**

Create `src/hooks/useNotifications.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import type { Notification, NotificationPreference } from '@/types/notifications';

export function useNotifications(limit = 20) {
  const { data: session } = useSession();
  return useQuery<{ data: Notification[]; unreadCount: number }>({
    queryKey: ['notifications', session?.user?.id, limit],
    queryFn: async () => {
      const res = await fetch(`/api/notifications?limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch notifications');
      return res.json();
    },
    enabled: !!session?.user?.id,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: string[]) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!res.ok) throw new Error('Failed to mark read');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useNotificationPreferences() {
  const { data: session } = useSession();
  return useQuery<{ data: NotificationPreference[] }>({
    queryKey: ['notification-preferences', session?.user?.id],
    queryFn: async () => {
      const res = await fetch('/api/notifications/preferences');
      if (!res.ok) throw new Error('Failed to fetch preferences');
      return res.json();
    },
    enabled: !!session?.user?.id,
  });
}

export function useUpdateNotificationPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      event_type: string;
      in_app_enabled: boolean;
      email_enabled: boolean;
      slack_enabled: boolean;
    }) => {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error('Failed to update preference');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useNotifications.ts
git commit -m "feat: add notification TanStack Query hooks"
```

---

### Task 9: Update NotificationsPanel (Bell Icon)

**Files:**
- Modify: `src/components/notifications/NotificationsPanel.tsx`

- [ ] **Step 1: Rewrite NotificationsPanel to use notifications table**

Replace the entire file content of `src/components/notifications/NotificationsPanel.tsx` with:

```typescript
'use client';
import { useRef, useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Bell, CheckCheck } from 'lucide-react';
import { CardSpinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useNotifications, useMarkNotificationsRead } from '@/hooks/useNotifications';
import { useRouter } from 'next/navigation';
import { CATEGORY_LABELS } from '@/lib/notifications/events';
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
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/notifications/NotificationsPanel.tsx
git commit -m "feat: switch NotificationsPanel from audit logs to notifications table"
```

---

### Task 10: RBAC Updates

**Files:**
- Modify: `src/lib/auth/rbac.ts`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Update RBAC route definitions**

In `src/lib/auth/rbac.ts`, update the `ROLE_ROUTES` object. Change:
- `/reporting` from `treasury_manager` to `accountant`
- `/compliance` from `accountant` to `auditor`
- Add `/settings/notifications` before `/settings` entry

Replace the `ROLE_ROUTES` constant (lines 4-23):

```typescript
export const ROLE_ROUTES: Record<string, UserRole> = {
  '/transfers': 'treasury_manager',
  '/swaps': 'treasury_manager',
  '/bridges': 'treasury_manager',
  '/ramps': 'treasury_manager',
  '/payments': 'treasury_manager',
  '/treasury': 'treasury_manager',
  '/yield': 'treasury_manager',
  '/reporting': 'accountant',
  '/settings/billing': 'treasury_manager',
  '/settings/notifications': 'auditor',
  '/compliance': 'auditor',
  '/settings': 'accountant',
  '/invoices': 'accountant',
  '/wallets': 'accountant',
  '/bank-accounts': 'accountant',
  '/api/payments': 'treasury_manager',
  '/api/billing': 'treasury_manager',
  '/api/kyb': 'treasury_manager',
  '/api/kyc': 'auditor',
};
```

- [ ] **Step 2: Update Sidebar navigation**

In `src/components/layout/Sidebar.tsx`, update the `NAV_GROUPS` array:

Change line 61 (`Compliance` minRole) from `'accountant'` to `'auditor'`:
```typescript
{ label: 'Compliance', href: '/compliance', icon: ShieldCheck, minRole: 'auditor' },
```

Change line 89 (`Reporting` minRole) from `'treasury_manager'` to `'accountant'`:
```typescript
{ label: 'Reporting', href: '/reporting', icon: FileBarChart, minRole: 'accountant' },
```

Add `Bell` to the lucide-react import, then add a Notifications entry in the Settings group before Account Management:
```typescript
import { /* existing imports */, Bell } from 'lucide-react';
```

In the Settings nav group (lines 93-98), add the Notifications item:
```typescript
{
  heading: 'Settings',
  items: [
    { label: 'Notifications', href: '/settings/notifications', icon: Bell },
    { label: 'Account Management', href: '/settings/accounts', icon: Users, minRole: 'treasury_manager' },
    { label: 'Billing', href: '/settings/billing', icon: CreditCard, minRole: 'treasury_manager' },
    { label: 'External Integrations', href: '/settings/integrations', icon: Plug, minRole: 'treasury_manager' },
  ],
},
```

Note: No `minRole` on Notifications means all roles can access it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/rbac.ts src/components/layout/Sidebar.tsx
git commit -m "feat: update RBAC routes and sidebar for new permissions"
```

---

### Task 11: Update Permissions Matrix

**Files:**
- Modify: `src/app/(app)/settings/accounts/page.tsx`

- [ ] **Step 1: Replace the CAPABILITIES array**

In `src/app/(app)/settings/accounts/page.tsx`, replace the `CAPABILITIES` array (lines 47-58) with:

```typescript
const CAPABILITIES: { label: string; auditor: boolean; accountant: boolean; treasury_manager: boolean }[] = [
  { label: 'View dashboard & analytics',      auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'View transactions & audit trail', auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'View invoices & vendors',         auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'View compliance',                 auditor: true,  accountant: true,  treasury_manager: true  },
  { label: 'View reporting',                  auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'View payments history',           auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'View transfers history',          auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'View swaps & ramps history',      auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'View bridges history',            auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'View yield positions',            auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'View AI recommendations',         auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Manage invoices & vendors',       auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Link wallets & bank accounts',    auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Link ERP systems',                auditor: false, accountant: true,  treasury_manager: true  },
  { label: 'Execute payments',                auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Execute transfers',               auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Execute swaps & ramps',           auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Execute bridges',                 auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Execute yield deposit/withdrawal',auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Generate treasury rules',         auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Treasury AI & recommendations',   auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Manage integrations & billing',   auditor: false, accountant: false, treasury_manager: true  },
  { label: 'Manage users & permissions',      auditor: false, accountant: false, treasury_manager: true  },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/settings/accounts/page.tsx
git commit -m "feat: expand permissions matrix to 23 capabilities"
```

---

### Task 12: Settings > Notifications Page

**Files:**
- Create: `src/app/(app)/settings/notifications/page.tsx`

- [ ] **Step 1: Create the notifications settings page**

Create `src/app/(app)/settings/notifications/page.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useNotificationPreferences, useUpdateNotificationPreference } from '@/hooks/useNotifications';
import { EVENT_CATALOG, CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/notifications/events';
import { hasRole } from '@/lib/auth/rbac';
import { ChevronDown, Bell, Mail, MessageSquare, Info } from 'lucide-react';
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

  // Bulk toggle: check if all events in this category are enabled for a channel
  const allInApp = events.every((e) => preferences.get(e.eventType)?.in_app ?? true);
  const allEmail = events.every((e) => preferences.get(e.eventType)?.email ?? true);
  const allSlack = events.every((e) => preferences.get(e.eventType)?.slack ?? true);

  const handleBulkToggle = (channel: 'in_app' | 'email' | 'slack') => {
    const allOn = channel === 'in_app' ? allInApp : channel === 'email' ? allEmail : allSlack;
    events.forEach((e) => onToggle(e.eventType, channel, !allOn));
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Category header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <span className="text-sm font-semibold text-foreground">{CATEGORY_LABELS[category]}</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div>
          {/* Bulk toggles row */}
          <div className="flex items-center px-4 py-2 border-b border-border/60 bg-muted/10">
            <span className="flex-1 text-xs text-muted-foreground font-medium">Toggle all</span>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-1.5 w-14 justify-center">
                <Toggle checked={allInApp} onChange={() => handleBulkToggle('in_app')} />
              </div>
              <div className="flex items-center gap-1.5 w-14 justify-center">
                <Toggle checked={allEmail} onChange={() => handleBulkToggle('email')} />
              </div>
              <div className="flex items-center gap-1.5 w-14 justify-center">
                <Toggle
                  checked={allSlack}
                  onChange={() => handleBulkToggle('slack')}
                  disabled={!slackConnected}
                />
              </div>
            </div>
          </div>

          {/* Event rows */}
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
                    <Toggle
                      checked={slack}
                      onChange={(v) => onToggle(event.eventType, 'slack', v)}
                      disabled={!slackConnected}
                    />
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

  // TODO: check if enterprise has Slack connected — for now, check from integrations
  const [slackConnected] = useState(false); // Will be fetched from API

  // Build preferences map
  const prefMap = new Map<string, { in_app: boolean; email: boolean; slack: boolean }>();
  (prefsData?.data ?? []).forEach((p) => {
    prefMap.set(p.event_type, {
      in_app: p.in_app_enabled,
      email: p.email_enabled,
      slack: p.slack_enabled,
    });
  });

  const handleToggle = (eventType: NotificationEventType, channel: 'in_app' | 'email' | 'slack', value: boolean) => {
    const existing = prefMap.get(eventType);
    updatePref.mutate({
      event_type: eventType,
      in_app_enabled: channel === 'in_app' ? value : (existing?.in_app ?? true),
      email_enabled: channel === 'email' ? value : (existing?.email ?? true),
      slack_enabled: channel === 'slack' ? value : (existing?.slack ?? true),
    });
    // Optimistic update
    prefMap.set(eventType, {
      in_app: channel === 'in_app' ? value : (existing?.in_app ?? true),
      email: channel === 'email' ? value : (existing?.email ?? true),
      slack: channel === 'slack' ? value : (existing?.slack ?? true),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notification Preferences</h1>
        <p className="text-sm text-muted-foreground mt-1">Choose how you want to be notified for each event type.</p>
      </div>

      {/* Column headers */}
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
          <div className="w-14 flex flex-col items-center gap-1 relative">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">Slack</span>
            {!slackConnected && (
              <div className="absolute -top-1 -right-1" title="Connect Slack in Settings > Integrations">
                <Info className="h-3 w-3 text-amber-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category sections */}
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/settings/notifications/page.tsx
git commit -m "feat: add Settings > Notifications preferences page"
```

---

### Task 13: Integrate NotificationService into AI Recommendation Routes

**Files:**
- Modify: `src/app/api/treasury/recommendations/generate/route.ts`
- Modify: `src/app/api/treasury/recommendations/[id]/approve/route.ts`
- Modify: `src/app/api/treasury/recommendations/[id]/reject/route.ts`

- [ ] **Step 1: Add notification to recommendation generation**

In `src/app/api/treasury/recommendations/generate/route.ts`, add import at top:

```typescript
import { NotificationService } from '@/lib/notifications/service';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';
```

After the audit log write (after line 129), before the auto-execute block, add:

```typescript
  // Notify — non-blocking
  const emailHtml = recommendationEmailHtml({
    id: rec.id,
    action: result.action,
    recommendedAmountUsd: rec.recommended_amount_usd,
    totalBankBalanceUsd: rec.total_bank_balance_usd,
    obligationsInWindowUsd: rec.obligations_in_window_usd,
    safetyBufferTargetUsd: rec.safety_buffer_target_usd,
    obligationLookaheadDays: rec.obligation_lookahead_days,
    aiReasoning: reasoning,
    stablecoinToken: rec.stablecoin_token,
    stablecoinChain: rec.stablecoin_chain,
    bankLabel: 'Bank Account',
    walletLabel: 'Wallet',
    status: rec.status,
    expiresAt: rec.expires_at,
  });

  NotificationService.notify({
    eventType: requiresApproval ? 'recommendation_pending' : 'recommendation_auto_executed',
    enterpriseId: enterpriseId,
    title: requiresApproval ? 'New AI Recommendation — Approval Required' : 'AI Recommendation Auto-Executed',
    body: `${result.action === 'onramp' ? 'On-ramp' : result.action === 'offramp' ? 'Off-ramp' : 'No action'} ${result.recommendedAmountUsd ? '$' + Math.round(result.recommendedAmountUsd).toLocaleString() : ''}`,
    link: requiresApproval ? `/treasury?reviewRec=${rec.id}` : '/treasury',
    metadata: {
      recommendationId: rec.id,
      action: result.action,
      amount: result.recommendedAmountUsd,
      _emailSubject: requiresApproval ? 'Action Required: New AI Recommendation' : 'AI Recommendation Auto-Executed',
      _emailHtml: emailHtml,
    },
    actorId: session.user.id,
  }).catch(() => {});
```

- [ ] **Step 2: Add notification to recommendation approval**

In `src/app/api/treasury/recommendations/[id]/approve/route.ts`, add imports and after the audit log write, add:

```typescript
import { NotificationService } from '@/lib/notifications/service';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';

// After successful approval and execution, add:
const emailHtml = recommendationEmailHtml({
  id: rec.id,
  action: rec.action,
  recommendedAmountUsd: rec.recommended_amount_usd,
  totalBankBalanceUsd: rec.total_bank_balance_usd,
  obligationsInWindowUsd: rec.obligations_in_window_usd,
  safetyBufferTargetUsd: rec.safety_buffer_target_usd,
  obligationLookaheadDays: rec.obligation_lookahead_days,
  aiReasoning: rec.ai_reasoning,
  stablecoinToken: rec.stablecoin_token,
  stablecoinChain: rec.stablecoin_chain,
  bankLabel: 'Bank Account',
  walletLabel: 'Wallet',
  status: 'approved',
});

NotificationService.notify({
  eventType: 'recommendation_approved',
  enterpriseId: rec.enterprise_id,
  title: 'AI Recommendation Approved & Executed',
  body: `${rec.action === 'onramp' ? 'On-ramp' : 'Off-ramp'} of $${Math.round(Number(rec.recommended_amount_usd)).toLocaleString()} was approved`,
  link: '/treasury',
  metadata: {
    recommendationId: rec.id,
    _emailSubject: 'AI Recommendation Approved & Executed',
    _emailHtml: emailHtml,
  },
  actorId: session.user.id,
}).catch(() => {});
```

- [ ] **Step 3: Add notification to recommendation rejection**

In `src/app/api/treasury/recommendations/[id]/reject/route.ts`, add similar notification:

```typescript
import { NotificationService } from '@/lib/notifications/service';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';

// After the rejection update and audit log:
const emailHtml = recommendationEmailHtml({
  id: rec.id,
  action: rec.action,
  recommendedAmountUsd: rec.recommended_amount_usd,
  totalBankBalanceUsd: rec.total_bank_balance_usd,
  obligationsInWindowUsd: rec.obligations_in_window_usd,
  safetyBufferTargetUsd: rec.safety_buffer_target_usd,
  obligationLookaheadDays: rec.obligation_lookahead_days,
  aiReasoning: rec.ai_reasoning,
  stablecoinToken: rec.stablecoin_token,
  stablecoinChain: rec.stablecoin_chain,
  bankLabel: 'Bank Account',
  walletLabel: 'Wallet',
  status: 'rejected',
});

NotificationService.notify({
  eventType: 'recommendation_rejected',
  enterpriseId: rec.enterprise_id,
  title: 'AI Recommendation Rejected',
  body: `${rec.action === 'onramp' ? 'On-ramp' : 'Off-ramp'} recommendation was rejected${body.reason ? ': ' + body.reason : ''}`,
  link: '/treasury',
  metadata: {
    recommendationId: rec.id,
    rejectionReason: body.reason,
    _emailSubject: 'AI Recommendation Rejected',
    _emailHtml: emailHtml,
  },
  actorId: session.user.id,
}).catch(() => {});
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/treasury/recommendations/generate/route.ts src/app/api/treasury/recommendations/*/route.ts
git commit -m "feat: integrate NotificationService into recommendation API routes"
```

---

### Task 14: Deep Link for Review Modal

**Files:**
- Modify: `src/components/treasury/TreasuryPageClient.tsx`

- [ ] **Step 1: Add query param handling for reviewRec deep link**

Replace `src/components/treasury/TreasuryPageClient.tsx` with:

```typescript
'use client';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { TreasuryRulesForm } from './TreasuryRulesForm';
import { RecommendationList } from './RecommendationList';
import { ForecastingPageClient } from './ForecastingPageClient';
import { YieldPositionsSummary } from './YieldPositionsSummary';
import { TabNav } from '@/components/ui/tab-nav';
import { ReviewRecommendationModal } from './ReviewRecommendationModal';

type Tab = 'overview' | 'rules' | 'forecasting';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'rules', label: 'Treasury Rules' },
  { value: 'forecasting', label: 'Forecasting' },
];

export function TreasuryPageClient() {
  const [tab, setTab] = useState<Tab>('overview');
  const searchParams = useSearchParams();
  const router = useRouter();
  const reviewRecId = searchParams.get('reviewRec');

  const handleCloseReview = () => {
    // Clear the query param without full navigation
    const url = new URL(window.location.href);
    url.searchParams.delete('reviewRec');
    router.replace(url.pathname + url.search, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-6">
          <YieldPositionsSummary />
          <RecommendationList />
        </div>
      )}

      {tab === 'rules' && <TreasuryRulesForm />}

      {tab === 'forecasting' && <ForecastingPageClient />}

      {/* Deep link review modal */}
      {reviewRecId && (
        <ReviewRecommendationModal
          recommendationId={reviewRecId}
          onClose={handleCloseReview}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ReviewRecommendationModal component**

Create `src/components/treasury/ReviewRecommendationModal.tsx`. This component fetches a single recommendation by ID and displays the existing review dialog:

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SimpleMarkdown } from '@/components/ui/simple-markdown';
import { useApproveRecommendation, useRejectRecommendation } from '@/hooks/useTreasury';
import { useWallets } from '@/hooks/useWallets';
import { hasRole } from '@/lib/auth/rbac';
import { useToast } from '@/components/ui/toast';
import { ArrowRight } from 'lucide-react';
import type { AiRecommendation } from '@/types/database';

function formatUsd(v: string | number | null): string {
  if (v === null || v === undefined) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Number(v));
}

const ACTION_LABELS: Record<string, string> = {
  onramp: 'On-ramp',
  offramp: 'Off-ramp',
  no_action: 'No Action',
};

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  pending_approval: { label: 'Pending Approval', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  executed: { label: 'Executed', variant: 'success' },
  auto_executed: { label: 'Auto-executed', variant: 'success' },
  expired: { label: 'Expired', variant: 'secondary' },
};

interface Props {
  recommendationId: string;
  onClose: () => void;
}

export function ReviewRecommendationModal({ recommendationId, onClose }: Props) {
  const { data: session } = useSession();
  const { toast } = useToast();
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const approve = useApproveRecommendation();
  const reject = useRejectRecommendation();
  const { data: wallets } = useWallets();

  const { data: rec, isLoading } = useQuery<AiRecommendation>({
    queryKey: ['recommendation', recommendationId],
    queryFn: async () => {
      const res = await fetch(`/api/treasury/recommendations`);
      if (!res.ok) throw new Error('Failed');
      const { data } = await res.json();
      return data?.find((r: AiRecommendation) => r.id === recommendationId) ?? null;
    },
    enabled: !!recommendationId,
  });

  if (isLoading || !rec) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <div className="py-8 text-center text-sm text-muted-foreground">Loading recommendation...</div>
        </DialogContent>
      </Dialog>
    );
  }

  const isTreasuryManager = hasRole((session?.user?.role as any) ?? 'auditor', 'treasury_manager');
  const canAct = isTreasuryManager && rec.status === 'pending_approval' && new Date(rec.expires_at) > new Date();
  const statusConfig = STATUS_CONFIG[rec.status] ?? { label: rec.status, variant: 'secondary' as const };
  const targetWallet = wallets?.find((w) => w.chain === rec.stablecoin_chain);
  const walletLabel = targetWallet?.label || (targetWallet?.address ? `${targetWallet.address.slice(0, 6)}...${targetWallet.address.slice(-4)}` : 'Wallet');
  const bankLabel = rec.bank_account
    ? `${rec.bank_account.institution_name}${rec.bank_account.last4 ? ` ****${rec.bank_account.last4}` : ''}`
    : 'Bank Account';
  const chainLabel = rec.stablecoin_chain ? rec.stablecoin_chain.charAt(0).toUpperCase() + rec.stablecoin_chain.slice(1) : '';

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(rec.id);
      toast({ title: 'Recommendation approved and executed', variant: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Approval failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync({ id: rec.id, reason: rejectReason || undefined });
      toast({ title: 'Recommendation rejected', variant: 'success' });
      onClose();
    } catch (err) {
      toast({ title: 'Rejection failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  if (showReject) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Reject Recommendation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Optionally provide a reason for rejecting this recommendation.</p>
            <textarea
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
              rows={3}
              placeholder="Reason (optional)..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReject(false)}>Back</Button>
            <Button
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={handleReject}
              disabled={reject.isPending}
            >
              {reject.isPending ? 'Rejecting...' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>AI Recommendation — Review</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{ACTION_LABELS[rec.action] ?? rec.action}</span>
              {rec.recommended_amount_usd && (
                <span className="tabular-nums">{formatUsd(rec.recommended_amount_usd)}</span>
              )}
            </div>
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>

          <div className="border-l-2 border-[#19595b] pl-3 text-sm text-foreground space-y-2">
            <SimpleMarkdown text={rec.ai_reasoning} />
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 rounded-md p-2">
            <div>
              <span className="text-muted-foreground">Fiat</span>
              <div className="font-medium tabular-nums">{formatUsd(rec.total_bank_balance_usd)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Obligations ({rec.obligation_lookahead_days}d)</span>
              <div className="font-medium tabular-nums">{formatUsd(rec.obligations_in_window_usd)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">Safety Target</span>
              <div className="font-medium tabular-nums">{formatUsd(rec.safety_buffer_target_usd)}</div>
            </div>
          </div>

          {rec.action !== 'no_action' && rec.stablecoin_token && (
            <div className="flex items-center gap-2 text-xs bg-muted/40 rounded-md px-3 py-2">
              {rec.action === 'offramp' ? (
                <>
                  <span className="font-medium text-foreground">{rec.stablecoin_token} on {chainLabel} ({walletLabel})</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground">USD ({bankLabel})</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">USD ({bankLabel})</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="font-medium text-foreground">{rec.stablecoin_token} on {chainLabel} ({walletLabel})</span>
                </>
              )}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            {new Date(rec.created_at).toLocaleDateString()}
          </div>
        </div>

        {canAct ? (
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => setShowReject(true)}
              disabled={approve.isPending || reject.isPending}
            >
              Deny
            </Button>
            <Button
              onClick={handleApprove}
              disabled={approve.isPending || reject.isPending}
            >
              {approve.isPending ? 'Executing...' : 'Approve'}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/treasury/TreasuryPageClient.tsx src/components/treasury/ReviewRecommendationModal.tsx
git commit -m "feat: add deep link support for AI recommendation review modal"
```

---

### Task 15: Dev Email Preview Page

**Files:**
- Create: `src/app/dev/email-previews/page.tsx`

- [ ] **Step 1: Create the email preview page**

Create `src/app/dev/email-previews/page.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// Import all email template functions
import { actionNotificationEmail, alertEmail, infoEmail } from '@/lib/notifications/email-templates';
import { recommendationEmailHtml } from '@/lib/notifications/recommendation-email';
import { verifyEmailHtml } from '@/lib/email/templates/verify-email';
import { invitationEmailHtml } from '@/lib/email/templates/invitation';
import { monthlyBillEmailHtml } from '@/lib/email/templates/monthly-bill';

interface PreviewEntry {
  id: string;
  label: string;
  category: string;
  html: string;
}

const PREVIEWS: PreviewEntry[] = [
  // AI Recommendation emails
  {
    id: 'rec-pending',
    label: 'Recommendation Pending',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'abc-123',
      action: 'onramp',
      recommendedAmountUsd: '25000',
      totalBankBalanceUsd: '150000',
      obligationsInWindowUsd: '45000',
      safetyBufferTargetUsd: '67500',
      obligationLookaheadDays: 7,
      aiReasoning: '📊 Current Position\nYour fiat balance of $150,000 exceeds the safety buffer target of $67,500 by $82,500.\n\n💡 Reasoning\nWith $45,000 in obligations over the next 7 days and a 1.5x safety multiplier, you have significant surplus capital that could be earning yield in stablecoin positions.\n\n✅ Recommendation\nConvert $25,000 to USDC on Ethereum to optimize your treasury allocation while maintaining a comfortable safety margin.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'pending_approval',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  },
  {
    id: 'rec-auto-executed',
    label: 'Recommendation Auto-Executed',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'def-456',
      action: 'onramp',
      recommendedAmountUsd: '5000',
      totalBankBalanceUsd: '80000',
      obligationsInWindowUsd: '20000',
      safetyBufferTargetUsd: '30000',
      obligationLookaheadDays: 7,
      aiReasoning: '📊 Current Position\nYour fiat balance of $80,000 has a surplus of $50,000 above the safety target.\n\n💡 Reasoning\nThe recommended amount of $5,000 is below your approval threshold, so this was automatically executed.\n\n✅ Recommendation\nConverted $5,000 to USDC on Ethereum.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'auto_executed',
    }),
  },
  {
    id: 'rec-approved',
    label: 'Recommendation Approved',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'ghi-789',
      action: 'offramp',
      recommendedAmountUsd: '15000',
      totalBankBalanceUsd: '30000',
      obligationsInWindowUsd: '55000',
      safetyBufferTargetUsd: '82500',
      obligationLookaheadDays: 7,
      aiReasoning: '📊 Current Position\nYour fiat balance of $30,000 is below the safety buffer target of $82,500.\n\n💡 Reasoning\nUpcoming obligations require additional fiat liquidity.\n\n✅ Recommendation\nOff-ramp $15,000 USDC to cover upcoming obligations.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'approved',
    }),
  },
  {
    id: 'rec-rejected',
    label: 'Recommendation Rejected',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'jkl-012',
      action: 'onramp',
      recommendedAmountUsd: '50000',
      totalBankBalanceUsd: '200000',
      obligationsInWindowUsd: '40000',
      safetyBufferTargetUsd: '60000',
      obligationLookaheadDays: 7,
      aiReasoning: '📊 Current Position\nLarge surplus detected.\n\n💡 Reasoning\nSignificant idle capital.\n\n✅ Recommendation\nConvert $50,000 to USDC.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'rejected',
    }),
  },
  {
    id: 'rec-expired',
    label: 'Recommendation Expired',
    category: 'Treasury AI',
    html: recommendationEmailHtml({
      id: 'mno-345',
      action: 'onramp',
      recommendedAmountUsd: '10000',
      totalBankBalanceUsd: '100000',
      obligationsInWindowUsd: '25000',
      safetyBufferTargetUsd: '37500',
      obligationLookaheadDays: 7,
      aiReasoning: 'Recommendation expired without action.',
      stablecoinToken: 'USDC',
      stablecoinChain: 'ethereum',
      bankLabel: 'Chase ****4521',
      walletLabel: '0x1a2b...9f3c',
      status: 'expired',
    }),
  },

  // Action notification emails
  {
    id: 'transfer-completed',
    label: 'Transfer Completed',
    category: 'Transactions',
    html: actionNotificationEmail({
      title: 'Transfer Completed',
      details: [
        { label: 'Amount', value: '2.5 ETH' },
        { label: 'From', value: '0x1a2b...9f3c' },
        { label: 'To', value: '0x4d5e...2a1b' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Tx Hash', value: '0xabc123...def456' },
        { label: 'Status', value: 'Completed' },
      ],
      ctaLabel: 'View Transaction',
      ctaHref: '/transactions',
    }),
  },
  {
    id: 'swap-completed',
    label: 'Swap Completed',
    category: 'Swaps',
    html: actionNotificationEmail({
      title: 'Swap Completed',
      details: [
        { label: 'From', value: '10,000 USDC' },
        { label: 'To', value: '10,015 USDT' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Rate', value: '1.0015' },
        { label: 'Status', value: 'Completed' },
      ],
      ctaLabel: 'View Swap',
      ctaHref: '/swaps',
    }),
  },
  {
    id: 'onramp-completed',
    label: 'On-Ramp Completed',
    category: 'Ramps',
    html: actionNotificationEmail({
      title: 'On-Ramp Completed',
      details: [
        { label: 'Fiat Amount', value: '$25,000' },
        { label: 'Crypto Received', value: '25,000 USDC' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Exchange Rate', value: '1.0000' },
        { label: 'Fee', value: '$12.50' },
      ],
      ctaLabel: 'View Transaction',
      ctaHref: '/ramps',
    }),
  },
  {
    id: 'offramp-completed',
    label: 'Off-Ramp Completed',
    category: 'Ramps',
    html: actionNotificationEmail({
      title: 'Off-Ramp Completed',
      details: [
        { label: 'Crypto Sold', value: '15,000 USDC' },
        { label: 'Fiat Received', value: '$14,985' },
        { label: 'Bank', value: 'Chase ****4521' },
        { label: 'Fee', value: '$15.00' },
      ],
      ctaLabel: 'View Transaction',
      ctaHref: '/ramps',
    }),
  },
  {
    id: 'bridge-completed',
    label: 'Bridge Completed',
    category: 'Bridges',
    html: actionNotificationEmail({
      title: 'Bridge Completed',
      details: [
        { label: 'Token', value: 'USDC' },
        { label: 'Amount', value: '50,000' },
        { label: 'From Chain', value: 'Ethereum' },
        { label: 'To Chain', value: 'Solana' },
        { label: 'Bridge Fee', value: '$5.00' },
      ],
      ctaLabel: 'View Bridge',
      ctaHref: '/bridges',
    }),
  },
  {
    id: 'payment-sent',
    label: 'Payment Sent',
    category: 'Payments',
    html: actionNotificationEmail({
      title: 'Fiat Payment Sent',
      details: [
        { label: 'Amount', value: '$10,000' },
        { label: 'From', value: 'Chase ****4521' },
        { label: 'To', value: 'BoA ****8832' },
        { label: 'Status', value: 'Settled' },
      ],
      ctaLabel: 'View Payment',
      ctaHref: '/payments',
    }),
  },
  {
    id: 'yield-deposit',
    label: 'Yield Deposit Confirmed',
    category: 'Yield',
    html: actionNotificationEmail({
      title: 'Yield Deposit Confirmed',
      details: [
        { label: 'Protocol', value: 'Aave V3' },
        { label: 'Token', value: 'USDC' },
        { label: 'Amount', value: '100,000' },
        { label: 'APY', value: '4.2%' },
        { label: 'Chain', value: 'Ethereum' },
      ],
      ctaLabel: 'View Position',
      ctaHref: '/yield',
    }),
  },
  {
    id: 'scheduled-swap',
    label: 'Scheduled Swap Executed',
    category: 'Scheduled Ops',
    html: actionNotificationEmail({
      title: 'Scheduled Swap Executed',
      details: [
        { label: 'From', value: '5,000 USDC' },
        { label: 'To', value: '5,008 USDT' },
        { label: 'Chain', value: 'Ethereum' },
        { label: 'Deviation', value: '3 bps' },
      ],
      ctaLabel: 'View Details',
      ctaHref: '/swaps',
      scheduledDeviation: { toleranceBps: 50, actualBps: 3 },
    }),
  },

  // Alert emails
  {
    id: 'sanctions-alert',
    label: 'Sanctions Alert',
    category: 'Compliance',
    html: alertEmail({
      title: 'Sanctions Screening Alert',
      description: 'A transaction to address 0x4d5e...2a1b has been flagged by Chainalysis KYT for potential sanctions exposure. Immediate review required.',
      ctaLabel: 'Review in Compliance',
      ctaHref: '/compliance',
      severity: 'error',
    }),
  },
  {
    id: 'invoice-overdue',
    label: 'Invoice Overdue',
    category: 'Invoices',
    html: alertEmail({
      title: 'Invoice Overdue',
      description: 'Invoice #INV-2026-0042 from Acme Corp ($12,500) is 3 days past due.',
      ctaLabel: 'View Invoice',
      ctaHref: '/invoices',
      severity: 'warning',
    }),
  },
  {
    id: 'scheduled-op-failed',
    label: 'Scheduled Operation Failed',
    category: 'Scheduled Ops',
    html: alertEmail({
      title: 'Scheduled Operation Failed',
      description: 'A scheduled swap of 10,000 USDC to USDT failed: insufficient liquidity at the requested price.',
      ctaLabel: 'View Details',
      ctaHref: '/swaps',
      severity: 'error',
    }),
  },
  {
    id: 'payment-failed',
    label: 'Billing Payment Failed',
    category: 'Billing',
    html: alertEmail({
      title: 'Payment Failed',
      description: 'Your monthly billing payment of $299 failed. Please update your payment method to avoid service interruption.',
      ctaLabel: 'Update Payment Method',
      ctaHref: '/settings/billing',
      severity: 'error',
    }),
  },
  {
    id: 'scheduled-op-flagged',
    label: 'Scheduled Op Flagged',
    category: 'Scheduled Ops',
    html: alertEmail({
      title: 'Scheduled Operation Needs Authorization',
      description: 'A scheduled ramp of $50,000 has a rate deviation of 75 bps (tolerance: 50 bps). Manual authorization required within 24 hours.',
      ctaLabel: 'Review & Authorize',
      ctaHref: '/swaps',
      severity: 'warning',
    }),
  },

  // Informational emails
  {
    id: 'wallet-connected',
    label: 'Wallet Connected',
    category: 'Wallets & Accounts',
    html: infoEmail({
      title: 'Wallet Connected',
      description: 'A new Ethereum wallet (0x1a2b...9f3c) was connected to your organization.',
      ctaLabel: 'View Wallets',
      ctaHref: '/wallets',
    }),
  },
  {
    id: 'member-invited',
    label: 'Member Invited',
    category: 'Team',
    html: infoEmail({
      title: 'Team Member Invited',
      description: 'john@example.com was invited to join your organization as an Accountant.',
      ctaLabel: 'Manage Team',
      ctaHref: '/settings/accounts',
    }),
  },
  {
    id: 'role-changed',
    label: 'Role Changed',
    category: 'Team',
    html: infoEmail({
      title: 'Role Updated',
      description: "Jane Smith's role was changed from Accountant to Treasury Manager.",
      ctaLabel: 'View Team',
      ctaHref: '/settings/accounts',
    }),
  },
  {
    id: 'treasury-rule-created',
    label: 'Treasury Rule Created',
    category: 'Treasury Rules',
    html: infoEmail({
      title: 'Treasury Rule Created',
      description: 'A new treasury rule "Conservative Buffer" was created with a 2.0x safety multiplier.',
      ctaLabel: 'View Rules',
      ctaHref: '/treasury',
    }),
  },
  {
    id: 'kyc-status',
    label: 'KYC Status Changed',
    category: 'KYC / KYB',
    html: infoEmail({
      title: 'KYC Verification Approved',
      description: 'Your identity verification has been approved. You now have full access to Vantor.',
      ctaLabel: 'View Profile',
      ctaHref: '/settings/accounts',
    }),
  },

  // Existing emails
  {
    id: 'verify-email',
    label: 'Verify Email',
    category: 'Authentication',
    html: verifyEmailHtml({ fullName: 'John Williams', verifyUrl: 'https://app.vantor.xyz/verify?token=abc123' }),
  },
  {
    id: 'invitation',
    label: 'Team Invitation',
    category: 'Authentication',
    html: invitationEmailHtml({ inviterName: 'John Williams', signupUrl: 'https://app.vantor.xyz/register?invite=abc123' }),
  },
  {
    id: 'monthly-bill',
    label: 'Monthly Bill',
    category: 'Billing (Existing)',
    html: monthlyBillEmailHtml({ enterpriseName: 'Acme Corp', billingPeriod: 'March 2026', totalAmount: '$1,247.50' }),
  },
];

// Group by category
const categories = Array.from(new Set(PREVIEWS.map((p) => p.category)));

export default function EmailPreviewsPage() {
  if (process.env.NODE_ENV !== 'development') {
    return <div className="p-8">Not available in production.</div>;
  }

  const [selected, setSelected] = useState(PREVIEWS[0].id);
  const preview = PREVIEWS.find((p) => p.id === selected);

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="w-72 border-r border-border overflow-y-auto bg-muted/20">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-bold text-foreground">Email Previews</h1>
          <p className="text-xs text-muted-foreground mt-1">Dev only - {PREVIEWS.length} templates</p>
        </div>
        {categories.map((cat) => (
          <div key={cat}>
            <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
              {cat}
            </div>
            {PREVIEWS.filter((p) => p.category === cat).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cn(
                  'w-full text-left px-4 py-2 text-sm transition-colors border-b border-border/30',
                  selected === p.id
                    ? 'bg-[#19595b]/10 text-[#19595b] font-medium dark:bg-teal-500/20 dark:text-teal-300'
                    : 'text-foreground hover:bg-muted/40'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Preview */}
      <div className="flex-1 bg-gray-100 dark:bg-gray-900 p-6">
        {preview && (
          <iframe
            srcDoc={preview.html}
            title={preview.label}
            className="w-full h-full rounded-lg border border-border shadow-sm bg-white"
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: Visit `http://localhost:3000/dev/email-previews` and cycle through all templates.

- [ ] **Step 3: Commit**

```bash
git add src/app/dev/email-previews/page.tsx
git commit -m "feat: add dev-only email preview page for all notification templates"
```

---

### Task 16: Integrate Notifications into Remaining API Routes

**Files:**
- Multiple API route files across the codebase

This task adds `NotificationService.notify()` calls to all remaining API routes that correspond to event types. The pattern is the same as Task 13 — import the service, call `notify()` after the audit log write, fire-and-forget.

- [ ] **Step 1: Add notify calls to all remaining routes**

For each API route, add:
1. `import { NotificationService } from '@/lib/notifications/service';`
2. After the audit log write, add a `NotificationService.notify({...}).catch(() => {})` call
3. Use the appropriate `eventType`, `title`, `body`, `link`, and `metadata` (including `_emailSubject` and `_emailHtml`)
4. For actions originating from recommendations or scheduled ops, set `metadata.origin` appropriately

Routes to integrate (add notify calls after existing audit log writes):
- `POST /api/transfers` → `transfer_completed`
- `POST /api/swaps` → `swap_completed`
- `POST /api/bridges` → `bridge_completed`
- `POST /api/payments` (fiat) → `payment_sent`
- `POST /api/yield/deposit` → `yield_deposit_confirmed`
- `POST /api/yield/withdraw` → `yield_withdrawal_confirmed`
- Scheduled operations executor (`src/lib/scheduled-operations/executor.ts`) → `scheduled_swap_executed`, `scheduled_bridge_executed`, `scheduled_ramp_executed`, `scheduled_operation_flagged`, `scheduled_operation_failed`
- `POST /api/wallets` (connect) → `wallet_connected`
- `DELETE /api/wallets/[id]` → `wallet_disconnected`
- `POST /api/bank-accounts` → `bank_account_linked`
- `DELETE /api/bank-accounts/[id]` → `bank_account_removed`
- `POST /api/erp` (connect) → `erp_connected`
- `DELETE /api/erp/[id]` → `erp_disconnected`
- `POST /api/treasury/rules` → `treasury_rule_created`
- `PATCH /api/treasury/rules/[id]` → `treasury_rule_updated`
- `POST /api/admin/invitations` → `member_invited`
- Admin member removal → `member_removed`
- Admin role change → `role_changed`
- KYC/KYB webhook handlers → `kyc_status_changed`, `kyb_status_changed`
- Stripe webhook → `payment_failed`, `subscription_changed`
- Recommendation expiration cron → `recommendation_expired`

For each route, use the appropriate email template tier:
- Treasury AI routes: `recommendationEmailHtml()`
- Action routes (transfers, swaps, etc.): `actionNotificationEmail()`
- Alert routes (compliance, scheduled op failed): `alertEmail()`
- Info routes (team, wallets, rules): `infoEmail()`

For the ramp events specifically: set `metadata.origin = 'recommendation'` when the ramp was triggered by a recommendation approval or auto-execution, and `metadata.origin = 'scheduled_operation'` when triggered by a scheduled operation.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: integrate NotificationService into all API routes"
```

---

### Task 17: Check Slack Connection Status for Settings Page

**Files:**
- Modify: `src/app/(app)/settings/notifications/page.tsx`

- [ ] **Step 1: Add Slack connection status check**

In the notifications settings page, replace the hardcoded `slackConnected` state with an API call. Add a query to check if the enterprise has an active Slack integration:

```typescript
// Add to imports
import { useQuery } from '@tanstack/react-query';

// Replace the hardcoded useState with:
const { data: slackData } = useQuery<{ connected: boolean }>({
  queryKey: ['slack-status'],
  queryFn: async () => {
    const res = await fetch('/api/integrations/slack/status');
    if (!res.ok) return { connected: false };
    return res.json();
  },
});
const slackConnected = slackData?.connected ?? false;
```

If no `/api/integrations/slack/status` endpoint exists, create a minimal one:

Create `src/app/api/integrations/slack/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ connected: false });

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('slack_integrations')
    .select('id')
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .maybeSingle();

  return NextResponse.json({ connected: !!data });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/settings/notifications/page.tsx src/app/api/integrations/slack/status/route.ts
git commit -m "feat: add Slack connection status check for notification settings"
```

---

### Task 18: Final Testing & Verification

- [ ] **Step 1: Verify dev server compiles**

Run: `npm run dev` — ensure no TypeScript errors.

- [ ] **Step 2: Test email previews**

Visit `http://localhost:3000/dev/email-previews` — verify all templates render correctly.

- [ ] **Step 3: Test notifications settings page**

Visit `http://localhost:3000/settings/notifications` — verify categories render, toggles work, role filtering works.

- [ ] **Step 4: Test bell icon**

Click the bell icon — verify it shows notifications from the new table (will be empty until events fire).

- [ ] **Step 5: Test RBAC changes**

Verify:
- Compliance page accessible by auditor
- Reporting page accessible by accountant
- Notifications settings accessible by all roles
- Sidebar items show/hide correctly per role

- [ ] **Step 6: Test permissions matrix**

Visit `/settings/accounts` — verify 23-row permissions matrix displays correctly.

- [ ] **Step 7: Test recommendation deep link**

Visit `/treasury?reviewRec=some-id` — verify modal opens (will show loading/not-found for fake ID).

- [ ] **Step 8: Test notification generation**

Generate an AI recommendation and verify:
- Notification appears in bell icon
- Email is sent (check Resend dashboard or mock logs)
- Slack message sent (if connected)

- [ ] **Step 9: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during testing"
```
