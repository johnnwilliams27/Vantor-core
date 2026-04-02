# Invoice Payment Flow

**Date:** 2026-04-02
**Status:** Approved
**Sub-project:** 3 of 4 (Transfer rename → Fiat payments → **Invoice pay flow** → Tooltips + invoice linking)

## Overview

Replace the current invoice "Pay" button (which just links to the payments/ramps page) with a full in-modal payment flow. The modal auto-detects whether to create a crypto transfer or fiat payment based on the invoice currency, pre-fills all fields, and lets the user confirm before executing.

## Modal: PayInvoiceModal

### Trigger

- "Pay" button on unpaid/overdue invoice rows in InvoiceTable
- "Pay Invoice" button in invoice detail modal

### Layout

**Header:** "Pay Invoice — {invoice_number}"

**Invoice Summary** (read-only):
- Invoice number, vendor name, amount, currency, due date

**Funding Source:**
- Stablecoin invoice (USDC/USDT): wallet selector from `useWallets()`, shows token balance for the invoice's token via `useWalletTokenBalance()`
- Fiat invoice (USD/EUR/GBP): bank account selector from bank accounts query, shows account balance

**Destination:**
- Pre-filled from `invoice.destination_address` or `invoice.vendor.wallet_address` (if available)
- If empty, editable fields appear:
  - Crypto: single wallet address input
  - Fiat: bank name, account holder, account number, routing number (4 fields)

**ERP Recording** (optional):
- Dropdown of active ERP configurations
- Pre-selected to invoice's `erp_config` if the invoice has one
- "None" option available

**Memo:**
- Pre-filled with "Invoice {invoice_number} — {vendor_name}"
- Editable

### Confirmation Step

1. User clicks "Pay" button in modal footer
2. Footer replaces with confirmation text: "This will send {amount} {currency} from {source_name} to {destination}. This action cannot be undone."
3. Two buttons: "Go Back" / "Confirm Payment"
4. "Confirm Payment" executes the payment

### Execution

**Crypto invoices (USDC/USDT):**
- POST to `/api/transfers` with: fromWalletId, toAddress, chain (from wallet), token (from invoice currency), amount, memo, invoiceId
- Transfer creates immediately (instant for crypto)
- Invoice linked via `invoiceId`

**Fiat invoices (USD/EUR/GBP):**
- POST to `/api/payments` with: fromBankAccountId, toBankName, toAccountNumber, toRoutingNumber, toAccountHolder, amount, currency, memo, invoiceId
- Payment goes to `pending` (settles in ~2 business days)
- Invoice linked via `invoiceId`
- Invoice status updated to `paid` on settlement (handled by existing fiat settlement cron)

### After Execution

- Toast: "Payment sent" (crypto) or "Payment sent — settlement typically takes 2 business days" (fiat)
- Invalidate queries: `['invoices']`, `['transfers']` or `['fiat-payments']`
- Close modal

## Component Structure

### New File: `src/components/invoices/PayInvoiceModal.tsx`

Props:
```typescript
interface PayInvoiceModalProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

### Modified File: `src/components/invoices/InvoiceTable.tsx`

- Replace the existing pay invoice Dialog with `<PayInvoiceModal>`
- Remove the Link-based pay buttons (no longer navigating to /payments or /ramps)
- Both the inline "Pay" button and the detail modal "Pay Invoice" button open the same `PayInvoiceModal`

## What Does NOT Change

- Invoice detail modal — stays as-is, just the "Pay Invoice" button at the bottom opens PayInvoiceModal instead of the old dialog
- Invoice table columns — no changes
- API routes — uses existing `/api/transfers` and `/api/payments` endpoints
- No new API routes needed
