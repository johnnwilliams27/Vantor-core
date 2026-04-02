# Fiat Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fiat bank-to-bank payment capabilities — send/schedule payments in USD/EUR/GBP from a linked bank account to an external bank account, with realistic settlement simulation.

**Architecture:** New `fiat_payments` table, banking adapter methods for fiat payments, API routes at `/api/payments`, UI forms + history table at `/payments`, agent tools, seed data. Settlement handled by a cron job that checks pending payments past their estimated settlement time.

**Tech Stack:** Next.js 14 App Router, Supabase, TanStack Query, react-hook-form + Zod, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-02-fiat-payments-design.md`

---

## File Structure

### New Files
- `supabase/migrations/0022_fiat_payments.sql` — DB schema
- `src/types/fiat-payments.ts` — TypeScript types
- `src/app/api/payments/route.ts` — GET + POST
- `src/app/api/payments/[id]/route.ts` — GET + DELETE
- `src/app/api/cron/process-fiat-settlements/route.ts` — Settlement cron
- `src/hooks/useFiatPayments.ts` — TanStack Query hooks
- `src/components/payments/SendPaymentForm.tsx` — Send form
- `src/components/payments/SchedulePaymentForm.tsx` — Schedule form
- `src/app/(app)/payments/page.tsx` — Page

### Modified Files
- `src/types/database.ts` — Add FiatPayment interface, audit actions
- `src/lib/banking/interface.ts` — Add fiat payment types + adapter methods
- `src/lib/banking/mock/bridge-mock.ts` — Add mock implementation
- `src/lib/banking/factory.ts` — Export type (if needed)
- `src/components/layout/Sidebar.tsx` — Add Payments nav item
- `src/components/layout/Topbar.tsx` — Add page title
- `src/lib/auth/rbac.ts` — Add route mappings
- `src/lib/agent/tools.ts` — Add 3 agent tools
- `src/lib/agent/context.ts` — Update system prompt
- `src/components/agent/ToolCallCard.tsx` — Tool display names
- `src/components/transactions/AllTab.tsx` — Add payment type
- `src/components/notifications/NotificationsPanel.tsx` — Add notification colors
- `src/lib/test-mode/seed/transactions.ts` — Add seed data
- `src/lib/test-mode/seed/audit.ts` — Add audit entries
- `src/lib/test-mode/seed/wipe.ts` — Add table to wipe list
- `vercel.json` — Add cron entry

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0022_fiat_payments.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0022_fiat_payments.sql`:

```sql
CREATE TABLE fiat_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id         UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  from_bank_account_id  UUID NOT NULL REFERENCES bank_accounts(id),
  to_bank_name          TEXT NOT NULL,
  to_account_number     TEXT NOT NULL,
  to_routing_number     TEXT NOT NULL,
  to_account_holder     TEXT NOT NULL,
  amount                NUMERIC(36, 6) NOT NULL,
  currency              TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  scheduled_for         TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  settled_at            TIMESTAMPTZ,
  estimated_settlement  TIMESTAMPTZ,
  provider_payment_id   TEXT,
  invoice_id            UUID REFERENCES invoices(id),
  memo                  TEXT,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fiat_payments_pending
  ON fiat_payments(status, estimated_settlement)
  WHERE status = 'pending';

CREATE INDEX idx_fiat_payments_scheduled
  ON fiat_payments(status, scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

CREATE INDEX idx_fiat_payments_user
  ON fiat_payments(user_id, enterprise_id);

ALTER TABLE fiat_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fiat payments"
  ON fiat_payments FOR SELECT
  USING (user_id = auth.uid() OR enterprise_id IN (
    SELECT enterprise_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert own fiat payments"
  ON fiat_payments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own fiat payments"
  ON fiat_payments FOR UPDATE
  USING (user_id = auth.uid());

CREATE TRIGGER set_fiat_payments_updated_at
  BEFORE UPDATE ON fiat_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 2: Run migration on both Supabase projects**

Run via Supabase Management API on dev (`spllxotyxipdvfpkkvgu`) and production (`lfujbwemavgiifkltrag`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0022_fiat_payments.sql
git commit -m "feat: add fiat_payments table"
```

---

## Task 2: Types & Banking Adapter

**Files:**
- Create: `src/types/fiat-payments.ts`
- Modify: `src/types/database.ts`
- Modify: `src/lib/banking/interface.ts`
- Modify: `src/lib/banking/mock/bridge-mock.ts`

- [ ] **Step 1: Create types file**

Create `src/types/fiat-payments.ts`:

```typescript
export interface FiatPayment {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  from_bank_account_id: string;
  to_bank_name: string;
  to_account_number: string;
  to_routing_number: string;
  to_account_holder: string;
  amount: string;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  scheduled_for: string | null;
  executed_at: string | null;
  settled_at: string | null;
  estimated_settlement: string | null;
  provider_payment_id: string | null;
  invoice_id: string | null;
  memo: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  // joined
  from_bank_account?: {
    id: string;
    institution_name: string;
    account_name: string | null;
    last4: string | null;
    nickname: string | null;
  };
}
```

- [ ] **Step 2: Add audit actions to database.ts**

In `src/types/database.ts`, add to `AuditAction` union:
```typescript
  | 'fiat_payment_create' | 'fiat_payment_execute'
  | 'fiat_payment_cancel' | 'fiat_payment_settle'
```

- [ ] **Step 3: Add fiat payment types to banking interface**

In `src/lib/banking/interface.ts`, add these interfaces and update `IBankingAdapter`:

```typescript
// ---- Fiat Payments (bank-to-bank) ----

export interface FiatPaymentParams {
  fromBankAccountRef: string;
  toBankName: string;
  toAccountNumber: string;
  toRoutingNumber: string;
  toAccountHolder: string;
  amount: number;
  currency: string;
  memo?: string;
}

export interface FiatPaymentResult {
  providerPaymentId: string;
  status: 'pending';
  estimatedSettlement: string;
}

export interface FiatPaymentStatusResult {
  status: 'pending' | 'completed' | 'failed';
  settledAt: string | null;
}
```

Add to `IBankingAdapter`:
```typescript
  // Fiat payments (bank-to-bank)
  createFiatPayment(params: FiatPaymentParams): Promise<FiatPaymentResult>;
  getFiatPaymentStatus(providerPaymentId: string): Promise<FiatPaymentStatusResult>;
```

- [ ] **Step 4: Add mock implementation**

In `src/lib/banking/mock/bridge-mock.ts`, add to the class:

```typescript
  // ---- Fiat Payments (bank-to-bank) ----

  async createFiatPayment(params: FiatPaymentParams): Promise<FiatPaymentResult> {
    await delay(400);

    // Estimate 2 business days for settlement
    const now = new Date();
    let settleDays = 2;
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 5) settleDays = 4; // Friday → Tuesday
    if (dayOfWeek === 6) settleDays = 3; // Saturday → Tuesday
    if (dayOfWeek === 0) settleDays = 2; // Sunday → Tuesday

    const estimated = new Date(now.getTime() + settleDays * 24 * 60 * 60 * 1000);

    return {
      providerPaymentId: genId('mock_fp'),
      status: 'pending',
      estimatedSettlement: estimated.toISOString(),
    };
  }

  async getFiatPaymentStatus(providerPaymentId: string): Promise<FiatPaymentStatusResult> {
    await delay(200);

    // Mock: consider settled if called (cron only calls when past estimated time)
    return {
      status: 'completed',
      settledAt: new Date().toISOString(),
    };
  }
```

Update the import line to include the new types:
```typescript
import type {
  IBankingAdapter,
  RampQuoteParams, RampQuote, RampExecuteParams, RampResult,
  SwapQuoteParams, SwapQuote, SwapExecuteParams, SwapResult,
  BridgeQuoteParams, BridgeQuote, BridgeExecuteParams, BridgeExecuteResult,
  FiatPaymentParams, FiatPaymentResult, FiatPaymentStatusResult,
} from '../interface';
```

- [ ] **Step 5: Commit**

```bash
git add src/types/fiat-payments.ts src/types/database.ts src/lib/banking/interface.ts src/lib/banking/mock/bridge-mock.ts
git commit -m "feat: add fiat payment types and mock banking adapter"
```

---

## Task 3: API Routes

**Files:**
- Create: `src/app/api/payments/route.ts`
- Create: `src/app/api/payments/[id]/route.ts`
- Create: `src/app/api/cron/process-fiat-settlements/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create GET + POST route**

Create `src/app/api/payments/route.ts`. Follow the same pattern as `src/app/api/transfers/route.ts`:

GET: List fiat payments. Requires `accountant` role. Joins `bank_accounts` for display. Filters by enterprise_id. Optional `status` query param.

POST: Create fiat payment. Requires `treasury_manager`. Zod schema:
- `fromBankAccountId: z.string().uuid()`
- `toBankName: z.string().min(1)`
- `toAccountNumber: z.string().min(4)`
- `toRoutingNumber: z.string().min(4)`
- `toAccountHolder: z.string().min(1)`
- `amount: z.string().regex(/^\d+(\.\d{1,2})?$/)`
- `currency: z.enum(['USD', 'EUR', 'GBP'])`
- `scheduledFor: z.string().datetime().optional()`
- `invoiceId: z.string().uuid().optional()`
- `memo: z.string().max(2000).optional()`

Flow:
1. Verify bank account belongs to user
2. If `scheduledFor`: insert with status `pending`, no execution
3. If immediate: call `adapter.createFiatPayment()`, insert with `provider_payment_id`, `estimated_settlement`, `executed_at`
4. Audit log `fiat_payment_create`

- [ ] **Step 2: Create GET + DELETE [id] route**

Create `src/app/api/payments/[id]/route.ts`:

GET: Single payment by ID, scoped by enterprise.

DELETE: Cancel. Only allow if `scheduled_for IS NOT NULL` AND `executed_at IS NULL` (scheduled but not sent). In-flight payments cannot be cancelled. Audit log `fiat_payment_cancel`.

- [ ] **Step 3: Create settlement cron**

Create `src/app/api/cron/process-fiat-settlements/route.ts`:

1. Auth via CRON_SECRET
2. Process scheduled payments: query where `status = 'pending'` and `scheduled_for <= NOW()` and `executed_at IS NULL`. Execute each via adapter, update `executed_at`, `provider_payment_id`, `estimated_settlement`.
3. Process settlements: query where `status = 'pending'` and `estimated_settlement <= NOW()` and `executed_at IS NOT NULL`. Call `adapter.getFiatPaymentStatus()`. Update to `completed`/`failed`, set `settled_at`. Audit log `fiat_payment_settle`.
4. If settled payment has `invoice_id`, update invoice `status = 'paid'`, `paid_at = now()`.

- [ ] **Step 4: Update vercel.json**

Add cron entry:
```json
{ "path": "/api/cron/process-fiat-settlements", "schedule": "*/5 * * * *" }
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/payments/ src/app/api/cron/process-fiat-settlements/ vercel.json
git commit -m "feat: add fiat payment API routes and settlement cron"
```

---

## Task 4: Hooks & UI Forms

**Files:**
- Create: `src/hooks/useFiatPayments.ts`
- Create: `src/components/payments/SendPaymentForm.tsx`
- Create: `src/components/payments/SchedulePaymentForm.tsx`

- [ ] **Step 1: Create hooks**

Create `src/hooks/useFiatPayments.ts` with:
- `useFiatPayments(status?)` — GET `/api/payments`, returns `FiatPayment[]`
- `useCreateFiatPayment()` — POST mutation, invalidates `['fiat-payments']`

- [ ] **Step 2: Create SendPaymentForm**

Create `src/components/payments/SendPaymentForm.tsx`:
- From: bank account selector (query `['bank-accounts']`)
- Destination: bank name, account holder, account number, routing number (structured Input fields)
- Amount + currency selector (USD/EUR/GBP)
- Invoice selector (optional dropdown of unpaid invoices from `useInvoices('unpaid')`)
- Memo (optional)
- Button greyed out until all required fields filled
- On submit: POST to `/api/payments`, toast, invalidate `['fiat-payments']`
- Card title: "Send Payment"

- [ ] **Step 3: Create SchedulePaymentForm**

Create `src/components/payments/SchedulePaymentForm.tsx`:
- Same fields as Send + DateTimePicker
- Info text: "Payments execute at the scheduled time. Settlement typically takes 2 business days."
- Card title with Calendar icon: "Schedule Payment"
- Button greyed out until required fields + date filled

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFiatPayments.ts src/components/payments/
git commit -m "feat: add fiat payment hooks and form components"
```

---

## Task 5: Page & Navigation

**Files:**
- Create: `src/app/(app)/payments/page.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/Topbar.tsx`
- Modify: `src/lib/auth/rbac.ts`

- [ ] **Step 1: Create payments page**

Create `src/app/(app)/payments/page.tsx`:

Layout: two-column grid (SendPaymentForm + SchedulePaymentForm), PaymentHistory below.

PaymentHistory:
- Fetches from `/api/payments`
- Columns: From, To, Amount, Currency, Status, Scheduled, Settled, Date
- From = bank account nickname or institution_name + last4
- To = account holder + bank name
- Status: "Pending Settlement" for in-flight, "Scheduled" for not-yet-executed, "Completed" for settled
- Cancel button only on scheduled (not yet executed) payments
- Cancel confirmation modal
- Click row for detail modal showing: from bank, destination details (bank name, account holder, routing/account numbers), amount, currency, scheduled date, executed date, estimated settlement, settled date, memo, invoice link

- [ ] **Step 2: Update Sidebar**

In `src/components/layout/Sidebar.tsx`, add after Transfers:
```typescript
{ label: 'Payments', href: '/payments', icon: Banknote, minRole: 'treasury_manager' },
```

Make sure `Banknote` is imported from lucide-react (it may already be imported, check first).

- [ ] **Step 3: Update Topbar**

Add `'/payments': 'Payments'` to `PAGE_TITLES`.

- [ ] **Step 4: Update RBAC**

Add `/payments` and `/api/payments` to route mappings in `src/lib/auth/rbac.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/payments/ src/components/layout/Sidebar.tsx src/components/layout/Topbar.tsx src/lib/auth/rbac.ts
git commit -m "feat: add fiat payments page and navigation"
```

---

## Task 6: Agent Tools, AllTab & Notifications

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/lib/agent/context.ts`
- Modify: `src/components/agent/ToolCallCard.tsx`
- Modify: `src/components/transactions/AllTab.tsx`
- Modify: `src/components/notifications/NotificationsPanel.tsx`

- [ ] **Step 1: Add agent tools**

In `src/lib/agent/tools.ts`, add 3 tools before ALL_TOOLS:

`getFiatPayments` — `get_fiat_payments`, queries `fiat_payments` table, minRole treasury_manager
`createFiatPayment` — `create_fiat_payment`, POSTs to `/api/payments`, minRole treasury_manager
`scheduleFiatPayment` — `schedule_fiat_payment`, POSTs to `/api/payments` with scheduledFor, minRole treasury_manager

Add all 3 to ALL_TOOLS under a `// Fiat payments` comment.

- [ ] **Step 2: Update system prompt**

In `src/lib/agent/context.ts`, add to treasury_manager: "You can send fiat payments between bank accounts in USD, EUR, and GBP. Payments settle in approximately 2 business days."

- [ ] **Step 3: Update ToolCallCard**

Add `get_fiat_payments`, `create_fiat_payment`, `schedule_fiat_payment` display mappings.

- [ ] **Step 4: Update AllTab**

In `src/components/transactions/AllTab.tsx`:
1. Import `FiatPayment` from `@/types/fiat-payments`
2. Add `'payment'` to the UnifiedRow type union
3. Add `mapFiatPayments()` function: from = bank name, to = account holder, currency, amount, status
4. Fetch from `/api/payments` in the query
5. Add `payment:` to TYPE_BADGE with appropriate color
6. Merge into `all` array

- [ ] **Step 5: Update NotificationsPanel**

Add to ACTION_DOT:
```typescript
fiat_payment_create:  'bg-purple-500',
fiat_payment_execute: 'bg-purple-400',
fiat_payment_cancel:  'bg-red-500',
fiat_payment_settle:  'bg-emerald-500',
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/ src/components/agent/ src/components/transactions/AllTab.tsx src/components/notifications/
git commit -m "feat: add fiat payment agent tools, transaction history, and notifications"
```

---

## Task 7: Seed Data & Wipe

**Files:**
- Modify: `src/lib/test-mode/seed/transactions.ts`
- Modify: `src/lib/test-mode/seed/audit.ts`
- Modify: `src/lib/test-mode/seed/wipe.ts`

- [ ] **Step 1: Add fiat payment seed data**

In `src/lib/test-mode/seed/transactions.ts`, add a function to seed ~10 fiat payments:
- Use existing test bank accounts (JPMorgan, SVB, Mercury, Barclays, HSBC, Deutsche Bank)
- External destinations with realistic bank names/routing numbers
- Mix: 5 completed (with settled_at), 3 pending (with estimated_settlement in future), 2 scheduled (with scheduled_for in future, no executed_at)
- Various currencies (USD, EUR, GBP)
- 2 linked to invoices (if invoice IDs available)

- [ ] **Step 2: Add audit entries**

In `src/lib/test-mode/seed/audit.ts`, add entries for `fiat_payment_create` and `fiat_payment_settle`.

- [ ] **Step 3: Update wipe**

In `src/lib/test-mode/seed/wipe.ts`, add `'fiat_payments'` to the tables list.

- [ ] **Step 4: Commit**

```bash
git add src/lib/test-mode/seed/
git commit -m "feat: add fiat payment seed data"
```

---

## Task 8: Build Verification

- [ ] **Step 1: Run the build**

```bash
cd C:/Users/John/crypto-treasury && npx next build
```

Fix any TypeScript errors.

- [ ] **Step 2: Verify dev server**

Navigate to:
- `/payments` — should show Send + Schedule forms + empty Payment History
- `/transfers` — should still work (no regression)
- `/transactions` — should show "Payment" type in All Activity

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from fiat payments implementation"
```
