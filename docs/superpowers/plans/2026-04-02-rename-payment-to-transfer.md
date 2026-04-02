# Rename Payment → Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the "Payment" concept to "Transfer" across the entire codebase — database, API, types, UI, agent tools, seed data.

**Architecture:** Bottom-up approach: rename DB tables first, then types, then library code, then API routes, then UI components, then agent/config. This order ensures each layer compiles against the one below it.

**Tech Stack:** Supabase (SQL), Next.js 14 App Router, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-02-rename-payment-to-transfer-design.md`

---

## File Structure

### Files to Rename (move)
- `src/types/payments.ts` → `src/types/transfers.ts`
- `src/lib/payments/executor.ts` → `src/lib/transfers/executor.ts`
- `src/components/payments/SendPaymentForm.tsx` → `src/components/transfers/SendTransferForm.tsx`
- `src/components/payments/SchedulePaymentForm.tsx` → `src/components/transfers/ScheduleTransferForm.tsx`
- `src/app/(app)/payments/page.tsx` → `src/app/(app)/transfers/page.tsx`
- `src/app/api/payments/route.ts` → `src/app/api/transfers/route.ts`
- `src/app/api/payments/[id]/route.ts` → `src/app/api/transfers/[id]/route.ts`
- `src/app/api/cron/process-scheduled-payments/route.ts` → `src/app/api/cron/process-scheduled-transfers/route.ts`
- `src/components/transactions/PaymentsTab.tsx` → `src/components/transactions/TransfersTab.tsx`
- `src/components/reporting/sections/PaymentsSection.tsx` → `src/components/reporting/sections/TransfersSection.tsx`

### Files to Modify (in place)
- `src/types/database.ts` — rename types, audit actions
- `src/lib/agent/tools.ts` — rename tool names/descriptions
- `src/lib/agent/context.ts` — update system prompt
- `src/lib/auth/rbac.ts` — route prefix
- `src/lib/compliance/travel-rule.ts` — param name
- `src/lib/realtime/subscriptions.ts` — channel/table name
- `src/components/layout/Sidebar.tsx` — nav link
- `src/components/layout/Topbar.tsx` — page title
- `src/components/notifications/NotificationsPanel.tsx` — audit action colors
- `src/components/transactions/AllTab.tsx` — type/mapping
- `src/components/charts/PaymentVolume.tsx` — rename to TransferVolume
- `src/components/agent/ToolCallCard.tsx` — tool name labels
- `src/components/reporting/section-config.ts` — section key
- `src/hooks/useReportData.ts` — query key/endpoint
- `src/lib/test-mode/seed/transactions.ts` — table name
- `src/lib/test-mode/seed/audit.ts` — action names
- `src/lib/test-mode/seed/compliance.ts` — references
- `src/lib/test-mode/seed/wipe.ts` — table names
- `vercel.json` — cron path
- `supabase/migrations/0021_rename_payments_to_transfers.sql` — new migration

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0021_rename_payments_to_transfers.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0021_rename_payments_to_transfers.sql`:

```sql
-- Rename payments → transfers
ALTER TABLE payments RENAME TO transfers;
ALTER TABLE payment_attempts RENAME TO transfer_attempts;

-- Rename columns
ALTER TABLE transfer_attempts RENAME COLUMN payment_id TO transfer_id;

-- Rename indexes
ALTER INDEX IF EXISTS idx_payments_scheduled RENAME TO idx_transfers_scheduled;

-- Rename audit action enum values
ALTER TYPE audit_action RENAME VALUE 'payment_create' TO 'transfer_create';
ALTER TYPE audit_action RENAME VALUE 'payment_execute' TO 'transfer_execute';
ALTER TYPE audit_action RENAME VALUE 'payment_cancel' TO 'transfer_cancel';
ALTER TYPE audit_action RENAME VALUE 'payment_schedule' TO 'transfer_schedule';
```

- [ ] **Step 2: Run migration on both Supabase projects**

Run via the Supabase Management API against both projects:
- Dev: `spllxotyxipdvfpkkvgu`
- Production: `lfujbwemavgiifkltrag`

Use the Node.js pattern established in earlier tasks:
```javascript
const body = JSON.stringify({ query: sql });
// POST to https://api.supabase.com/v1/projects/{projectId}/database/query
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0021_rename_payments_to_transfers.sql
git commit -m "feat: rename payments table to transfers (DB migration)"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `src/types/database.ts`
- Rename: `src/types/payments.ts` → `src/types/transfers.ts` (and update contents)

- [ ] **Step 1: Update database.ts**

In `src/types/database.ts`:

1. Rename `PaymentStatus` → `TransferStatus` (line ~18)
2. In `AuditAction` union, rename:
   - `'payment_create'` → `'transfer_create'`
   - `'payment_execute'` → `'transfer_execute'`
   - `'payment_cancel'` → `'transfer_cancel'`
   - `'payment_schedule'` → `'transfer_schedule'`
3. Rename `interface Payment` → `interface Transfer` (line ~141)
   - Change `status: PaymentStatus` → `status: TransferStatus`
4. Rename `interface PaymentAttempt` → `interface TransferAttempt` (line ~167)
   - Change `payment_id: string` → `transfer_id: string`
5. In `GlPosting` interface, rename `payment_id` → `transfer_id`
6. In `KytTransfer` interface, rename `payment_id` → `transfer_id`
7. In `TravelRuleTransfer` interface, rename `payment_id` → `transfer_id`

- [ ] **Step 2: Create transfers.ts from payments.ts**

Delete `src/types/payments.ts`. Create `src/types/transfers.ts`:

```typescript
import type { ChainType, TokenSymbol, TransferStatus } from './database';

export interface SendTransferInput {
  fromWalletId: string;
  toAddress: string;
  chain: ChainType;
  token: TokenSymbol;
  amount: string;
  memo?: string;
  invoiceId?: string;
}

export interface ScheduleTransferInput extends SendTransferInput {
  scheduledFor: string;
}

export interface TransferResult {
  transferId: string;
  txHash?: string;
  status: TransferStatus;
  error?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts src/types/transfers.ts
git rm src/types/payments.ts
git commit -m "feat: rename Payment types to Transfer types"
```

---

## Task 3: Core Library — Executor

**Files:**
- Rename: `src/lib/payments/executor.ts` → `src/lib/transfers/executor.ts`

- [ ] **Step 1: Move and rename**

Create `src/lib/transfers/executor.ts` from `src/lib/payments/executor.ts`. In the new file:

1. Rename function `executePayment` → `executeTransfer`
2. Rename parameter `payment: Payment` → `transfer: Transfer`
3. Change all `.from('payments')` → `.from('transfers')`
4. Change all `.from('payment_attempts')` → `.from('transfer_attempts')`
5. Change `payment_id` column references → `transfer_id`
6. Change audit action `'payment_execute'` → `'transfer_execute'`
7. Update import: `import type { Payment }` → `import type { Transfer }`
8. Update all internal variable names from `payment` to `transfer`

Delete `src/lib/payments/executor.ts` and the `src/lib/payments/` directory.

- [ ] **Step 2: Update compliance travel-rule.ts**

In `src/lib/compliance/travel-rule.ts`:
- Rename `paymentId` parameter → `transferId`
- Update `details: { paymentId }` → `details: { transferId }`

- [ ] **Step 3: Update realtime subscriptions**

In `src/lib/realtime/subscriptions.ts`:
- Change `.channel('payments_realtime')` → `.channel('transfers_realtime')`
- Change `table: 'payments'` → `table: 'transfers'`

- [ ] **Step 4: Commit**

```bash
git add src/lib/transfers/executor.ts src/lib/compliance/travel-rule.ts src/lib/realtime/subscriptions.ts
git rm -r src/lib/payments/
git commit -m "feat: rename payment executor and library to transfer"
```

---

## Task 4: API Routes

**Files:**
- Rename: `src/app/api/payments/route.ts` → `src/app/api/transfers/route.ts`
- Rename: `src/app/api/payments/[id]/route.ts` → `src/app/api/transfers/[id]/route.ts`
- Rename: `src/app/api/cron/process-scheduled-payments/route.ts` → `src/app/api/cron/process-scheduled-transfers/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Move and update transfers route**

Create `src/app/api/transfers/route.ts` from `src/app/api/payments/route.ts`. Update:

1. Import: `executeTransfer` from `@/lib/transfers/executor`
2. Import: `Transfer` type from `@/types/database`
3. All `.from('payments')` → `.from('transfers')`
4. Audit actions: `'payment_schedule'` → `'transfer_schedule'`, `'payment_create'` → `'transfer_create'`
5. Console logs and error messages: "payment" → "transfer"

- [ ] **Step 2: Move and update transfers [id] route**

Create `src/app/api/transfers/[id]/route.ts` from `src/app/api/payments/[id]/route.ts`. Update:

1. All `.from('payments')` → `.from('transfers')`
2. Audit action: `'payment_cancel'` → `'transfer_cancel'`

- [ ] **Step 3: Move and update cron route**

Create `src/app/api/cron/process-scheduled-transfers/route.ts` from the old cron route. Update:

1. Import: `executeTransfer` from `@/lib/transfers/executor`
2. Import: `Transfer` type
3. All `.from('payments')` → `.from('transfers')`
4. Console log prefix: `[cron/payments]` → `[cron/transfers]`

- [ ] **Step 4: Update vercel.json**

Change:
```json
"path": "/api/cron/process-scheduled-payments"
```
To:
```json
"path": "/api/cron/process-scheduled-transfers"
```

- [ ] **Step 5: Delete old routes and commit**

```bash
git rm -r src/app/api/payments/
git rm src/app/api/cron/process-scheduled-payments/route.ts
git add src/app/api/transfers/ src/app/api/cron/process-scheduled-transfers/ vercel.json
git commit -m "feat: rename payment API routes to transfer"
```

---

## Task 5: UI Components — Forms

**Files:**
- Rename: `src/components/payments/SendPaymentForm.tsx` → `src/components/transfers/SendTransferForm.tsx`
- Rename: `src/components/payments/SchedulePaymentForm.tsx` → `src/components/transfers/ScheduleTransferForm.tsx`

- [ ] **Step 1: Create SendTransferForm**

Create `src/components/transfers/SendTransferForm.tsx` from `SendPaymentForm.tsx`. Update:

1. Component name: `SendPaymentForm` → `SendTransferForm`
2. Export name matches
3. API endpoint: `/api/payments` → `/api/transfers`
4. Query key: `['payments']` → `['transfers']`
5. Toast messages: "Payment sent" → "Transfer sent", "Insufficient balance" stays
6. CardTitle: "Send Payment" → "Send Transfer"
7. Button text: "Send Payment" → "Send Transfer", "Sending…" stays

- [ ] **Step 2: Create ScheduleTransferForm**

Create `src/components/transfers/ScheduleTransferForm.tsx` from `SchedulePaymentForm.tsx`. Update:

1. Component name: `SchedulePaymentForm` → `ScheduleTransferForm`
2. API endpoint: `/api/payments` → `/api/transfers`
3. Query key: `['payments']` → `['transfers']`
4. Toast messages: "Payment scheduled" → "Transfer scheduled"
5. CardTitle: "Schedule Payment" → "Schedule Transfer"
6. Button text: "Schedule Payment" → "Schedule Transfer"

- [ ] **Step 3: Delete old components and commit**

```bash
git rm -r src/components/payments/
git add src/components/transfers/
git commit -m "feat: rename payment form components to transfer"
```

---

## Task 6: UI Components — Page & Navigation

**Files:**
- Rename: `src/app/(app)/payments/page.tsx` → `src/app/(app)/transfers/page.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/lib/auth/rbac.ts`

- [ ] **Step 1: Create transfers page**

Create `src/app/(app)/transfers/page.tsx` from the old payments page. Update:

1. Imports: `SendTransferForm` from `@/components/transfers/SendTransferForm`, `ScheduleTransferForm` from `@/components/transfers/ScheduleTransferForm`
2. Import type: `Transfer` instead of `Payment`
3. All `Payment` type references → `Transfer`
4. Query key: `['payments']` → `['transfers']`
5. API endpoint: `/api/payments` → `/api/transfers`
6. Cancel endpoint: `/api/payments/${id}` → `/api/transfers/${id}`
7. CardTitle: "Payment History" → "Transfer History", title variables
8. Component name: `PaymentsPage` → `TransfersPage`, `PaymentList` → `TransferList`
9. Status colors key, filter config, export columns: rename "Payment" labels
10. Empty state text: "No payments yet" → "No transfers yet"
11. Cancel modal: "Cancel Payment" → "Cancel Transfer"
12. All toast messages: "payment" → "transfer"

- [ ] **Step 2: Update Sidebar**

In `src/components/layout/Sidebar.tsx`, change:
- `{ label: 'Payments', href: '/payments', icon: Send, minRole: 'treasury_manager' }`
→ `{ label: 'Transfers', href: '/transfers', icon: Send, minRole: 'treasury_manager' }`

- [ ] **Step 3: Update Topbar**

In `src/components/layout/Topbar.tsx`, in `PAGE_TITLES`:
- Remove: `'/payments': 'Payments'`
- Add: `'/transfers': 'Transfers'`

- [ ] **Step 4: Update RBAC**

In `src/lib/auth/rbac.ts`:
- Change `'/payments'` → `'/transfers'` in route prefix mappings
- Change `'/api/payments'` → `'/api/transfers'` in API route mappings

- [ ] **Step 5: Delete old page and commit**

```bash
git rm -r src/app/\(app\)/payments/
git add src/app/\(app\)/transfers/ src/components/layout/Sidebar.tsx src/components/layout/Topbar.tsx src/lib/auth/rbac.ts
git commit -m "feat: rename payments page and navigation to transfers"
```

---

## Task 7: Agent Tools & System Prompt

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/lib/agent/context.ts`
- Modify: `src/components/agent/ToolCallCard.tsx`

- [ ] **Step 1: Update agent tools**

In `src/lib/agent/tools.ts`:

1. Change import: `executePayment` → `executeTransfer` from `@/lib/transfers/executor`
2. Rename `getPayments` tool:
   - `name: 'get_payments'` → `name: 'get_transfers'`
   - Description: "payments" → "transfers"
   - `.from('payments')` → `.from('transfers')`
3. Rename `createPayment` tool:
   - `name: 'create_payment'` → `name: 'create_transfer'`
   - Description: "payment" → "transfer"
   - Function call: `executePayment` → `executeTransfer`
   - `.from('payments')` → `.from('transfers')`
   - Audit action: `'payment_create'` → `'transfer_create'`
4. Rename `schedulePayment` tool:
   - `name: 'schedule_payment'` → `name: 'schedule_transfer'`
   - Description: "payment" → "transfer"
   - `.from('payments')` → `.from('transfers')`
   - Audit action: `'payment_schedule'` → `'transfer_schedule'`
5. Update `ALL_TOOLS` array variable names
6. Update any references to payment in tool descriptions

- [ ] **Step 2: Update system prompt**

In `src/lib/agent/context.ts`:
- "create/schedule payments" → "create/schedule transfers"
- "For any payment, swap, or ramp action" → "For any transfer, swap, or ramp action"
- All other "payment" references → "transfer"

- [ ] **Step 3: Update ToolCallCard**

In `src/components/agent/ToolCallCard.tsx`:
- `get_payments` → `get_transfers`
- `create_payment` → `create_transfer`
- `schedule_payment` → `schedule_transfer`
- Display labels: "Payment" → "Transfer"

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/tools.ts src/lib/agent/context.ts src/components/agent/ToolCallCard.tsx
git commit -m "feat: rename payment agent tools to transfer"
```

---

## Task 8: Transaction History, Notifications & Reporting

**Files:**
- Modify: `src/components/transactions/AllTab.tsx`
- Rename: `src/components/transactions/PaymentsTab.tsx` → `src/components/transactions/TransfersTab.tsx`
- Modify: `src/components/notifications/NotificationsPanel.tsx`
- Rename: `src/components/reporting/sections/PaymentsSection.tsx` → `src/components/reporting/sections/TransfersSection.tsx`
- Modify: `src/components/reporting/section-config.ts`
- Modify: `src/hooks/useReportData.ts`
- Rename: `src/components/charts/PaymentVolume.tsx` → `src/components/charts/TransferVolume.tsx`

- [ ] **Step 1: Update AllTab**

In `src/components/transactions/AllTab.tsx`:
1. Remove `Payment` from import, add `Transfer`
2. Change `'payment'` type → `'transfer'` in `UnifiedRow` type
3. Rename `mapPayments` → `mapTransfers`, parameter type `Payment[]` → `Transfer[]`
4. Update TYPE_BADGE key: `payment:` → `transfer:`
5. API endpoint: `/api/payments` → `/api/transfers`
6. Variable name: `payments` → `transfers`

- [ ] **Step 2: Rename PaymentsTab**

Create `src/components/transactions/TransfersTab.tsx` from `PaymentsTab.tsx`:
1. Rename component, update imports, query key, API endpoint, type references, labels
2. Delete old file

- [ ] **Step 3: Update NotificationsPanel**

In `src/components/notifications/NotificationsPanel.tsx`:
- `payment_create:` → `transfer_create:`
- `payment_schedule:` → `transfer_schedule:`
- `payment_execute:` → `transfer_execute:`

- [ ] **Step 4: Rename PaymentsSection**

Create `src/components/reporting/sections/TransfersSection.tsx` from `PaymentsSection.tsx`:
1. Rename component, update imports, labels, search placeholder
2. Delete old file

- [ ] **Step 5: Update section-config.ts**

In `src/components/reporting/section-config.ts`:
- Change `'payments'` key → `'transfers'`
- Update label and description

- [ ] **Step 6: Update useReportData.ts**

In `src/hooks/useReportData.ts`:
- Query key: `['payments']` → `['transfers']`
- API endpoint: `/api/payments` → `/api/transfers`
- Property names in returned data

- [ ] **Step 7: Rename PaymentVolume chart**

Create `src/components/charts/TransferVolume.tsx` from `PaymentVolume.tsx`:
1. Rename component, query key `['payments-volume']` → `['transfers-volume']`
2. API endpoint: `/api/payments` → `/api/transfers`
3. Delete old file. Update any imports of this component (check dashboard or other pages).

- [ ] **Step 8: Commit**

```bash
git rm src/components/transactions/PaymentsTab.tsx src/components/reporting/sections/PaymentsSection.tsx src/components/charts/PaymentVolume.tsx
git add src/components/transactions/ src/components/notifications/ src/components/reporting/ src/hooks/useReportData.ts src/components/charts/TransferVolume.tsx
git commit -m "feat: rename payment references in transaction history, notifications, and reporting"
```

---

## Task 9: Seed Data & Wipe

**Files:**
- Modify: `src/lib/test-mode/seed/transactions.ts`
- Modify: `src/lib/test-mode/seed/audit.ts`
- Modify: `src/lib/test-mode/seed/compliance.ts`
- Modify: `src/lib/test-mode/seed/wipe.ts`

- [ ] **Step 1: Update transactions seed**

In `src/lib/test-mode/seed/transactions.ts`:
1. All `.from('payments')` → `.from('transfers')`
2. Variable names: `paymentIds` → `transferIds`
3. Comments: "payment" → "transfer"

- [ ] **Step 2: Update audit seed**

In `src/lib/test-mode/seed/audit.ts`:
1. `'payment_create'` → `'transfer_create'`
2. `'payment_execute'` → `'transfer_execute'`
3. `'payment_schedule'` → `'transfer_schedule'`
4. Entity types: `'payment'` → `'transfer'`

- [ ] **Step 3: Update compliance seed**

In `src/lib/test-mode/seed/compliance.ts`:
1. Payment ID references → transfer ID references
2. Variable names

- [ ] **Step 4: Update wipe**

In `src/lib/test-mode/seed/wipe.ts`:
1. `'payment_attempts'` → `'transfer_attempts'`
2. `'payments'` → `'transfers'`
3. Update any special handling comments

- [ ] **Step 5: Commit**

```bash
git add src/lib/test-mode/seed/
git commit -m "feat: rename payment references in seed data and wipe"
```

---

## Task 10: Build Verification & Cleanup

- [ ] **Step 1: Global search for remaining "payment" references**

Run a grep across the entire `src/` directory for any remaining references to the old names that should have been changed:

```bash
grep -rn "from('payments')" src/
grep -rn "'payment_create'" src/
grep -rn "PaymentStatus" src/
grep -rn "from '@/lib/payments" src/
grep -rn "from '@/components/payments" src/
grep -rn "from '@/types/payments" src/
grep -rn "/api/payments" src/
```

Fix any remaining references found. Note: `PaymentFailedGate.tsx` and `PaymentMethodTab.tsx` in billing are about Stripe subscription payments, NOT crypto transfers — these should NOT be renamed.

- [ ] **Step 2: Run the build**

```bash
cd C:/Users/John/crypto-treasury && npx next build
```

Fix any TypeScript errors.

- [ ] **Step 3: Verify dev server**

```bash
npm run dev
```

Navigate to:
- `/transfers` — should show Send Transfer + Schedule Transfer forms + Transfer History
- `/dashboard` — should render without errors
- `/transactions` — should show "Transfer" type badge instead of "Payment"

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining payment → transfer rename issues"
```
