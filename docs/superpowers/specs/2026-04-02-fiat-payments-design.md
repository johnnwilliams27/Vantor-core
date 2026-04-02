# Fiat Payments (Bank-to-Bank)

**Date:** 2026-04-02
**Status:** Approved
**Sub-project:** 2 of 4 (Transfer rename → **Fiat payments** → Invoice pay flow → Tooltips + invoice linking)

## Overview

Add fiat bank-to-bank payment capabilities to Vantor. Users can send payments in USD, EUR, or GBP from a linked bank account to an external bank account (by routing/account number). Payments simulate real settlement behavior — they go to `pending` on execution and settle after ~2 business days.

No wire transfers — bank transfers only. No fees (consistent with crypto transfers).

## Database

### New Table: `fiat_payments`

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
```

### Audit Actions

Add to `AuditAction` type:
- `fiat_payment_create`
- `fiat_payment_execute`
- `fiat_payment_cancel`
- `fiat_payment_settle`

## Banking Adapter

### New Interface Methods

Add to `IBankingAdapter` in `src/lib/banking/interface.ts`:

```typescript
interface FiatPaymentParams {
  fromBankAccountRef: string;
  toBankName: string;
  toAccountNumber: string;
  toRoutingNumber: string;
  toAccountHolder: string;
  amount: number;
  currency: string;
  memo?: string;
}

interface FiatPaymentResult {
  providerPaymentId: string;
  status: 'pending';
  estimatedSettlement: string; // ISO timestamp
}

interface FiatPaymentStatus {
  status: 'pending' | 'completed' | 'failed';
  settledAt: string | null;
}
```

### Mock Implementation

In `BridgeMockAdapter`:
- `createFiatPayment()` — returns `{ providerPaymentId: 'mock-fp-' + uuid, status: 'pending', estimatedSettlement: 2 business days from now }`
- `getFiatPaymentStatus(id)` — returns `completed` with `settledAt` if current time > estimated settlement, otherwise `pending`

## API Routes

| Method | Route | Purpose | Role |
|--------|-------|---------|------|
| GET | `/api/payments` | List fiat payments | accountant+ |
| POST | `/api/payments` | Create a fiat payment | treasury_manager |
| GET | `/api/payments/[id]` | Get single payment | treasury_manager |
| DELETE | `/api/payments/[id]` | Cancel a scheduled (not yet executed) payment | treasury_manager |
| GET | `/api/cron/process-fiat-settlements` | Settle pending payments past estimated settlement | CRON_SECRET |

### POST `/api/payments` Flow

1. Validate params with Zod
2. Verify source bank account belongs to user/enterprise
3. If `scheduledFor` provided: insert with status `pending`, don't execute yet
4. If immediate: call `adapter.createFiatPayment()`, insert with status `pending`, `provider_payment_id`, `estimated_settlement`
5. Audit log `fiat_payment_create`
6. Return created payment

### DELETE `/api/payments/[id]` Flow

1. Only allow cancel if `scheduled_for IS NOT NULL` and `executed_at IS NULL` (scheduled but not yet sent)
2. In-flight payments (pending settlement) cannot be cancelled
3. Set status to `cancelled`
4. Audit log `fiat_payment_cancel`

### Cron: `/api/cron/process-fiat-settlements`

1. Query `fiat_payments` where `status = 'pending'` and `estimated_settlement <= NOW()` and `executed_at IS NOT NULL`
2. For each: call `adapter.getFiatPaymentStatus(provider_payment_id)`
3. If completed: update `status = 'completed'`, `settled_at = now()`
4. If still pending: skip (check again next cycle)
5. If failed: update `status = 'failed'`
6. Audit log `fiat_payment_settle`
7. If linked to invoice: update invoice status to `paid`

Also process scheduled payments:
1. Query where `status = 'pending'` and `scheduled_for <= NOW()` and `executed_at IS NULL`
2. Execute via adapter
3. Update `executed_at`, `provider_payment_id`, `estimated_settlement`

Add to `vercel.json` with `*/5 * * * *` schedule.

## UI

### Page: `/payments`

Under Operations in sidebar (after Transfers).

**Layout:** Two-column grid (Send + Schedule) on top, PaymentHistory table below.

### SendPaymentForm

- From: bank account selector
- Destination: bank name, account holder, account number, routing number (structured fields)
- Amount + currency selector (USD/EUR/GBP)
- Invoice selector (optional — dropdown of unpaid invoices)
- Memo (optional)
- Button greyed out until required fields filled
- On success: toast, refresh history

### SchedulePaymentForm

- Same fields as Send + DateTimePicker
- Info text: "Payments execute at the scheduled time. Settlement typically takes 2 business days."

### PaymentHistory

- Columns: From, To, Amount, Currency, Status, Scheduled, Settled, Date
- From = source bank account name/nickname
- To = account holder + bank name
- Status: `Pending Settlement` for in-flight, `Completed` for settled
- Cancel button only on scheduled payments that haven't executed yet (NOT on in-flight pending)
- Cancel opens confirmation modal
- Click row for detail modal (from, to, amount, currency, routing/account numbers, settlement dates, memo, invoice link)

### Topbar & Sidebar

- Sidebar: add `{ label: 'Payments', href: '/payments', icon: Banknote, minRole: 'treasury_manager' }` under Operations
- Topbar: add `'/payments': 'Payments'` to PAGE_TITLES

### RBAC

- Add `/payments` and `/api/payments` to route mappings

## Agent Tools

| Tool | Description | Role |
|------|-------------|------|
| `create_fiat_payment` | Send a fiat bank-to-bank payment | treasury_manager |
| `schedule_fiat_payment` | Schedule a future fiat payment | treasury_manager |
| `get_fiat_payments` | List fiat payments | treasury_manager |

System prompt: "You can send fiat payments between bank accounts in USD, EUR, and GBP. Payments settle in approximately 2 business days."

## Transaction History (AllTab)

- Add `'payment'` type to unified view
- Fetch from `/api/payments`
- From = source bank name, To = destination account holder
- Currency = USD/EUR/GBP

## Seed Data

Add to lite test mode seed (`src/lib/test-mode/seed/`):
- 8-10 fiat payments across test bank accounts
- Mix of completed (settled), pending (in-flight), and scheduled
- Various currencies (USD, EUR, GBP)
- Some linked to invoices
- Audit log entries for fiat_payment_create/settle

## What Does NOT Change

- `transfers` table (crypto wallet-to-wallet) — unchanged
- `fiat_transactions` table (ramps) — unchanged, ramps are a separate concept
- Scheduled operations system — fiat payments handle their own scheduling via `scheduled_for` column (same pattern as transfers)
