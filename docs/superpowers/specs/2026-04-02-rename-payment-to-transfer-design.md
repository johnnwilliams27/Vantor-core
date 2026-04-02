# Rename Payment → Transfer

**Date:** 2026-04-02
**Status:** Approved
**Sub-project:** 1 of 4 (Transfer rename → Fiat payments → Invoice pay flow → Tooltips + invoice linking)

## Overview

Rename the "Payment" concept to "Transfer" across the entire codebase. Payments in Vantor are crypto wallet-to-wallet transfers (USDC/USDT), not fiat payments. This rename frees up the "Payment" name for the upcoming fiat bank-to-bank payment feature.

No new functionality — this is a pure rename of database, API, types, UI, agent tools, and seed data.

## Database Changes

### Table Renames

```sql
ALTER TABLE payments RENAME TO transfers;
ALTER TABLE payment_attempts RENAME TO transfer_attempts;
```

### Column Renames

```sql
ALTER TABLE transfer_attempts RENAME COLUMN payment_id TO transfer_id;
```

### Index Renames

```sql
ALTER INDEX idx_payments_scheduled RENAME TO idx_transfers_scheduled;
```

### Audit Action Enum Updates

Old → New:
- `payment_create` → `transfer_create`
- `payment_execute` → `transfer_execute`
- `payment_cancel` → `transfer_cancel`
- `payment_schedule` → `transfer_schedule`

```sql
ALTER TYPE audit_action RENAME VALUE 'payment_create' TO 'transfer_create';
ALTER TYPE audit_action RENAME VALUE 'payment_execute' TO 'transfer_execute';
ALTER TYPE audit_action RENAME VALUE 'payment_cancel' TO 'transfer_cancel';
ALTER TYPE audit_action RENAME VALUE 'payment_schedule' TO 'transfer_schedule';
```

### RLS Policies

Drop and recreate any RLS policies referencing the old table name.

### Foreign Keys

- `invoices.linked_tx_id` — this FK currently references `payments(id)`. After rename it automatically references `transfers(id)`. No change needed.
- `transfer_attempts.transfer_id` — FK automatically follows the table rename.

### Run on both Supabase projects

- Dev: `spllxotyxipdvfpkkvgu`
- Production: `lfujbwemavgiifkltrag`

## API Route Changes

| Old Route | New Route |
|-----------|-----------|
| `GET /api/payments` | `GET /api/transfers` |
| `POST /api/payments` | `POST /api/transfers` |
| `DELETE /api/payments/[id]` | `DELETE /api/transfers/[id]` |
| `GET /api/cron/process-scheduled-payments` | `GET /api/cron/process-scheduled-transfers` |

Update `vercel.json` cron entry path.

## TypeScript Type Changes

### `src/types/database.ts`

- `Payment` interface → `Transfer`
- `PaymentStatus` type → `TransferStatus`
- `PaymentAttempt` interface → `TransferAttempt`
- `AuditAction` union: rename all `payment_*` values to `transfer_*`

### `src/types/payments.ts` → `src/types/transfers.ts`

- `SendPaymentInput` → `SendTransferInput`
- `SchedulePaymentInput` → `ScheduleTransferInput`
- `PaymentResult` → `TransferResult`

## Component Changes

| Old Path | New Path |
|----------|----------|
| `src/components/payments/SendPaymentForm.tsx` | `src/components/transfers/SendTransferForm.tsx` |
| `src/components/payments/SchedulePaymentForm.tsx` | `src/components/transfers/ScheduleTransferForm.tsx` |

### UI Label Changes

- "Send Payment" → "Send Transfer"
- "Schedule Payment" → "Schedule Transfer"
- "Payment scheduled" → "Transfer scheduled"
- "Payment sent" → "Transfer sent"
- "Payment History" → "Transfer History"
- "Cancel Payment" → "Cancel Transfer"
- "Payment cancelled" → "Transfer cancelled"
- Card titles, toast messages, modal titles, button text

## Page Changes

| Old Path | New Path |
|----------|----------|
| `src/app/(app)/payments/page.tsx` | `src/app/(app)/transfers/page.tsx` |

### Topbar

Update `PAGE_TITLES` in `src/components/layout/Topbar.tsx`:
- Remove `'/payments': 'Payments'`
- Add `'/transfers': 'Transfers'`

### Sidebar

Update sidebar navigation:
- Link text: "Payments" → "Transfers"
- Link href: `/payments` → `/transfers`

## Executor Changes

`src/lib/payments/executor.ts` → `src/lib/transfers/executor.ts`

- Rename `executePayment()` → `executeTransfer()`
- Update all internal references to `payment` → `transfer`
- Update Supabase table references: `.from('payments')` → `.from('transfers')`
- Update audit actions

## Agent Tool Changes

In `src/lib/agent/tools.ts`:

| Old Tool Name | New Tool Name |
|---------------|---------------|
| `create_payment` | `create_transfer` |
| `schedule_payment` | `schedule_transfer` |
| `getPayments` | `getTransfers` |

Update tool descriptions: "payment" → "transfer" throughout.

### System Prompt

Update `src/lib/agent/context.ts`:
- "create/schedule payments" → "create/schedule transfers"
- "For any payment, swap, or ramp action" → "For any transfer, swap, or ramp action"

## Cron Changes

- Move `src/app/api/cron/process-scheduled-payments/route.ts` → `src/app/api/cron/process-scheduled-transfers/route.ts`
- Update `vercel.json`: change path from `/api/cron/process-scheduled-payments` to `/api/cron/process-scheduled-transfers`
- Update internal references: `.from('payments')` → `.from('transfers')`

## Transaction History Changes

### AllTab (`src/components/transactions/AllTab.tsx`)

- Change type `'payment'` → `'transfer'` in `UnifiedRow`
- Update `mapPayments()` → `mapTransfers()`
- Update `TYPE_BADGE` key
- Fetch from `/api/transfers` instead of `/api/payments`

### NotificationsPanel

- Update `ACTION_DOT` keys: `payment_create` → `transfer_create`, etc.

## Scheduled Operations

Update references in:
- `src/app/api/scheduled-operations/route.ts` — any payment references in comments
- Notification colors for scheduled operations (if any reference payment)

## Seed Data

Update `src/lib/test-mode/seed/transactions.ts`:
- Change `.from('payments')` → `.from('transfers')`
- Update audit action values in seed data

Update `src/lib/test-mode/seed/audit.ts`:
- `payment_create` → `transfer_create`
- `payment_execute` → `transfer_execute`
- `payment_schedule` → `transfer_schedule`

## Slack Integration

Update any references in:
- `src/lib/integrations/slack.ts` — if payment is mentioned in messages
- `src/app/api/integrations/slack/callback/route.ts` — if payment actions are handled

## Hook Changes

- `src/hooks/usePayments.ts` (if exists) or inline query key `['payments']` → `['transfers']`
- All `queryClient.invalidateQueries({ queryKey: ['payments'] })` → `['transfers']`

## Export Column Changes

Update CSV/PDF export column headers from "Payment" → "Transfer" where applicable.

## What Does NOT Change

- `fiat_transactions` table — stays as-is (used by ramps)
- Ramp forms, swap forms, bridge forms — no changes
- The scheduled operations system — type values stay as `'swap'`, `'bridge'`, `'ramp'` (no `'payment'` type in scheduled ops)
- Invoice `linked_tx_id` column name — stays generic
