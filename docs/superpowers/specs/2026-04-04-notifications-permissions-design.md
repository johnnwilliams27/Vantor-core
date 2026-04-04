# Notifications, Email Alerts & Permissions Update

**Date:** 2026-04-04
**Status:** Approved

## Overview

Add a unified notification system to Vantor that delivers in-app (bell icon), email, and Slack notifications for all significant events. Includes a full Settings > Notifications preferences page, expanded role permissions matrix, RBAC updates for accountant view access, and deep-link support for AI recommendation emails.

---

## 1. Data Model

### `notifications` table

Replaces the current audit-log-based bell icon with real notification records.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `enterprise_id` | UUID FK → enterprises | |
| `user_id` | UUID FK → user_profiles | Recipient |
| `event_type` | TEXT | e.g., `recommendation_pending` |
| `category` | TEXT | e.g., `treasury_ai` |
| `title` | TEXT | e.g., "New AI Recommendation" |
| `body` | TEXT | Short summary for bell icon |
| `metadata` | JSONB | Event-specific data (rec ID, amount, etc.) |
| `link` | TEXT | Deep link path, e.g., `/treasury?reviewRec=abc` |
| `read` | BOOLEAN DEFAULT false | |
| `emailed` | BOOLEAN DEFAULT false | |
| `slacked` | BOOLEAN DEFAULT false | |
| `created_at` | TIMESTAMPTZ | |

Indexes: `(user_id, read, created_at DESC)`, `(enterprise_id, event_type)`

RLS: users can only read/update their own notifications.

### `notification_preferences` table

Per-user, per-event-type toggles for each delivery channel.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → user_profiles | |
| `enterprise_id` | UUID FK → enterprises | |
| `event_type` | TEXT | Matches notification event_type |
| `in_app_enabled` | BOOLEAN DEFAULT true | |
| `email_enabled` | BOOLEAN DEFAULT true | |
| `slack_enabled` | BOOLEAN DEFAULT true | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| UNIQUE | `(user_id, event_type)` | |

When no row exists for a user + event_type, defaults are all enabled. Rows are created only when a user explicitly changes a preference.

RLS: users can only read/update their own preferences.

---

## 2. Event Type Catalog (38 events, 13 categories)

### Deduplication Rule

When an action originates from a parent event (recommendation or scheduled operation), only the parent event fires a notification. The `origin` field in metadata tracks this:
- `origin: 'recommendation'` — skip downstream action events (swap, ramp, etc.)
- `origin: 'scheduled_operation'` — skip downstream action events

### Full Catalog

| Category | Event Type | Description | In-App Default | Email Default |
|---|---|---|---|---|
| **Treasury AI** | `recommendation_pending` | New rec needs approval | treasury_manager, accountant | treasury_manager, accountant |
| | `recommendation_auto_executed` | Rec auto-executed below threshold | treasury_manager, accountant | treasury_manager, accountant |
| | `recommendation_approved` | Rec approved & executed | treasury_manager, accountant | treasury_manager, accountant |
| | `recommendation_rejected` | Rec was rejected | treasury_manager, accountant | treasury_manager, accountant |
| | `recommendation_expired` | Rec expired without action | treasury_manager, accountant | treasury_manager, accountant |
| **Transactions** | `transfer_completed` | Crypto transfer executed | treasury_manager, accountant | treasury_manager, accountant |
| | `transfer_scheduled` | Transfer scheduled for future | treasury_manager, accountant | treasury_manager, accountant |
| **Swaps** | `swap_completed` | Token swap executed | treasury_manager, accountant | treasury_manager, accountant |
| **Ramps** | `onramp_completed` | Fiat to crypto completed | treasury_manager, accountant | treasury_manager, accountant |
| | `offramp_completed` | Crypto to fiat completed | treasury_manager, accountant | treasury_manager, accountant |
| **Bridges** | `bridge_completed` | Cross-chain bridge executed | treasury_manager, accountant | treasury_manager, accountant |
| **Payments** | `payment_sent` | Fiat payment sent | treasury_manager, accountant | treasury_manager, accountant |
| | `payment_received` | Fiat payment received | treasury_manager, accountant | treasury_manager, accountant |
| **Yield** | `yield_deposit_confirmed` | Yield deposit confirmed | treasury_manager, accountant | treasury_manager, accountant |
| | `yield_withdrawal_confirmed` | Yield withdrawal confirmed | treasury_manager, accountant | treasury_manager, accountant |
| **Compliance** | `sanctions_alert` | Sanctions screening hit | treasury_manager, accountant | treasury_manager, accountant |
| | `travel_rule_notification` | Travel rule triggered | treasury_manager, accountant | treasury_manager, accountant |
| **Invoices** | `invoice_synced` | Invoice synced from ERP | treasury_manager, accountant | treasury_manager, accountant |
| | `invoice_overdue` | Invoice past due date | treasury_manager, accountant | treasury_manager, accountant |
| **Scheduled Ops** | `scheduled_swap_executed` | Scheduled swap completed | treasury_manager | treasury_manager |
| | `scheduled_bridge_executed` | Scheduled bridge completed | treasury_manager | treasury_manager |
| | `scheduled_ramp_executed` | Scheduled ramp completed | treasury_manager | treasury_manager |
| | `scheduled_operation_flagged` | Rate deviation needs authorization | treasury_manager | treasury_manager |
| | `scheduled_operation_failed` | Scheduled op failed | treasury_manager | treasury_manager |
| **Wallets & Accounts** | `wallet_connected` | Wallet connected | treasury_manager, accountant | treasury_manager, accountant |
| | `wallet_disconnected` | Wallet disconnected | treasury_manager, accountant | treasury_manager, accountant |
| | `bank_account_linked` | Bank account linked | treasury_manager, accountant | treasury_manager, accountant |
| | `bank_account_removed` | Bank account removed | treasury_manager, accountant | treasury_manager, accountant |
| | `erp_connected` | ERP system connected | treasury_manager, accountant | treasury_manager, accountant |
| | `erp_disconnected` | ERP system disconnected | treasury_manager, accountant | treasury_manager, accountant |
| **Treasury Rules** | `treasury_rule_created` | Treasury rule created | treasury_manager | treasury_manager |
| | `treasury_rule_updated` | Treasury rule updated | treasury_manager | treasury_manager |
| **Team** | `member_invited` | Team member invited | treasury_manager | treasury_manager |
| | `member_removed` | Team member removed | treasury_manager | treasury_manager |
| | `role_changed` | User role changed | treasury_manager | treasury_manager |
| **KYC/KYB** | `kyc_status_changed` | KYC verification update | treasury_manager + subject user | treasury_manager + subject user |
| | `kyb_status_changed` | KYB verification update | treasury_manager | treasury_manager |
| **Billing** | `payment_failed` | Billing payment failed | treasury_manager | treasury_manager |
| | `subscription_changed` | Subscription plan changed | treasury_manager | treasury_manager |

---

## 3. Notification Service Architecture

### File Structure

```
src/lib/notifications/
  service.ts              — core NotificationService
  events.ts               — event type definitions, categories, default recipient config
  email-templates.ts      — HTML email builders per category
  recommendation-email.ts — dedicated rich template for AI rec emails
```

### NotificationService.notify()

```typescript
NotificationService.notify({
  eventType: string,
  enterpriseId: string,
  metadata: Record<string, unknown>,
  actorId?: string,  // user who triggered the event (excluded from receiving)
})
```

**Flow:**

1. **Check origin** — if `metadata.origin` is set, skip (parent event handles notification)
2. **Resolve recipients** — query `user_profiles` by `enterprise_id`, filter by role using defaults from event catalog
3. **Exclude actor** — the user who performed the action doesn't get notified
4. **Check preferences** — for each recipient, look up `notification_preferences`. No row = defaults (all enabled)
5. **Bulk insert** — create `notifications` rows for all in-app-enabled recipients
6. **Send emails** — fire-and-forget via Resend for email-enabled recipients (from: `Vantor <notifications@vantor.xyz>`)
7. **Send Slack** — fire-and-forget via existing Slack integration for slack-enabled recipients (only if enterprise has Slack connected)

**Error handling:** Email/Slack send failures are logged but never propagate or block the parent API response. Same pattern as existing Slack integration.

---

## 4. Email Templates

### Sender

`Vantor <notifications@vantor.xyz>` — Resend domain already verified for vantor.xyz.

### Base Layout (all emails)

- Max-width 560px container, white background, 12px border-radius
- Teal header bar (`#19595b`) with Vantor logo
- Content area with 32px padding
- Footer with copyright
- Inline CSS only (email client compatibility)

### Template Tiers

**1. AI Recommendation (rich format)** — `recommendation_pending`, `recommendation_auto_executed`, `recommendation_approved`, `recommendation_rejected`, `recommendation_expired`
- Action badge (On-ramp / Off-ramp / No Action) with amount
- Context grid: Fiat Balance | Obligations | Safety Target
- AI Reasoning block with teal left border
- Movement details (e.g., "USD (Chase ****4521) -> USDC on Ethereum")
- For pending: two CTA buttons — "Review & Approve" (teal) and "Review & Reject" (outline), both link to `/treasury?reviewRec={id}`
- For auto_executed/approved/rejected/expired: single "View Details" button
- Expiration note for pending ("Expires in 24 hours")

**2. Action notification (standard format)** — transfers, swaps, ramps, bridges, payments, yield
- Title (e.g., "Swap Completed")
- Key details in 2-column grid (amount, tokens, chain, status, tx hash truncated)
- Single CTA button to relevant page
- For scheduled ops: includes deviation info if applicable

**3. Alert (minimal format)** — compliance, invoice overdue, scheduled op failed, billing failed
- Title with severity indicator (warning color)
- Short description
- CTA button to relevant page

**4. Informational (simple format)** — team changes, wallet/account events, treasury rules, KYC/KYB
- Title
- One-line description of what changed
- CTA button to relevant settings/page

---

## 5. Email Preview Page

Dev-only route at `/dev/email-previews`:
- Gated by `NODE_ENV === 'development'` — returns 404 in production
- Sidebar listing all 38 event types grouped by category, plus existing emails (verification, invitation, monthly bill)
- Main area renders the selected template in an iframe with realistic mock data
- No actual emails sent

---

## 6. Bell Icon / NotificationsPanel Update

Switch from audit-log-based to notifications-table-based:

- **API**: `GET /api/notifications?limit=20` — fetches from `notifications` table for current user
- **Unread count**: count of `read = false`, shown as badge
- **Mark read**: `PATCH /api/notifications/mark-read` — bulk or specific IDs
- **Click**: navigates to notification's `link` field (deep link)
- **Display**: title, body, timestamp, category icon per notification
- **Polling**: TanStack Query with 15-30s stale time (same as current approach)

Existing audit log endpoint untouched — still used by the audit trail page.

---

## 7. Settings > Notifications Page

New route at `/settings/notifications`, accessible to all roles.

### Layout
- Page title: "Notification Preferences"
- Brief description: "Choose how you want to be notified for each event type"
- 13 categories as collapsible sections
- Each event type as a row with three toggles: In-App | Email | Slack
- Category headers have bulk toggles per channel

### Behavior
- First load: no preference rows exist, all toggles show enabled (defaults)
- Toggle creates/updates the `notification_preferences` row
- Only event types relevant to user's role are shown
- Slack column disabled with tooltip if enterprise doesn't have Slack connected
- Changes save immediately on toggle (optimistic update, no save button)
- Fluid UX: smooth transitions, consistent with existing Vantor UI patterns

### Sidebar Navigation
Add "Notifications" under Settings, between Accounts and Billing. Accessible to all roles.

---

## 8. RBAC Updates

### Route-Level Changes (`src/lib/auth/rbac.ts`)

| Route | Current Min Role | New Min Role |
|---|---|---|
| `/reporting` | treasury_manager | accountant |
| `/compliance` | accountant | auditor |
| `/settings/notifications` | (new) | auditor |

### API Read-Access for Accountant

These GET endpoints change from `treasury_manager` to `accountant`:
- `GET /api/transfers`
- `GET /api/swaps` (history)
- `GET /api/bridges` (history)
- `GET /api/ramps` / fiat transactions (history)
- `GET /api/yield` (positions/history)
- `GET /api/treasury/recommendations`
- `GET /api/payments` (history)

POST/execute endpoints remain `treasury_manager`.

### Updated Permissions Matrix (Settings > Accounts)

Replaces the current 9-row matrix with 23 rows:

| Capability | Auditor | Accountant | Treasury Manager |
|---|---|---|---|
| View dashboard & analytics | Yes | Yes | Yes |
| View transactions & audit trail | Yes | Yes | Yes |
| View invoices & vendors | Yes | Yes | Yes |
| View compliance | Yes | Yes | Yes |
| View reporting | No | Yes | Yes |
| View payments history | No | Yes | Yes |
| View transfers history | No | Yes | Yes |
| View swaps & ramps history | No | Yes | Yes |
| View bridges history | No | Yes | Yes |
| View yield positions | No | Yes | Yes |
| View AI recommendations | No | Yes | Yes |
| Manage invoices & vendors | No | Yes | Yes |
| Link wallets & bank accounts | No | Yes | Yes |
| Link ERP systems | No | Yes | Yes |
| Execute payments | No | No | Yes |
| Execute transfers | No | No | Yes |
| Execute swaps & ramps | No | No | Yes |
| Execute bridges | No | No | Yes |
| Execute yield deposit/withdrawal | No | No | Yes |
| Generate treasury rules | No | No | Yes |
| Treasury AI & recommendations | No | No | Yes |
| Manage integrations & billing | No | No | Yes |
| Manage users & permissions | No | No | Yes |

---

## 9. Deep Link for AI Recommendation Review

When a user clicks a CTA from an AI recommendation email, they land on `/treasury?reviewRec={id}`.

**Flow:**
1. Treasury AI page reads `reviewRec` query param on mount
2. Fetches the specific recommendation if not in the list
3. Opens the existing review modal with that recommendation pre-loaded
4. After action or dismiss, clears the query param from URL

**Edge cases:**
- Expired: modal opens showing expired status, action buttons disabled
- Already actioned: modal shows current status
- No permission: modal opens read-only (no action buttons)
- Not logged in: redirect to login, then back to deep link URL after auth

---

## 10. Integration Points

Each existing API route gets a single `NotificationService.notify()` call added:

- `POST /api/treasury/recommendations/generate` → `recommendation_pending` or `recommendation_auto_executed`
- `POST /api/treasury/recommendations/[id]/approve` → `recommendation_approved`
- `POST /api/treasury/recommendations/[id]/reject` → `recommendation_rejected`
- Expiration cron → `recommendation_expired`
- Transfer, swap, ramp, bridge, payment, yield API routes → respective event types
- Scheduled operation executor → `scheduled_*` events
- Wallet/bank/ERP connect/disconnect routes → respective events
- Treasury rule create/update → respective events
- Admin invitation/removal/role change → team events
- KYC/KYB status change handlers → respective events
- Stripe webhook → billing events

Origin-based dedup: when an action comes from a recommendation or scheduled operation, set `metadata.origin` so downstream events are suppressed.
