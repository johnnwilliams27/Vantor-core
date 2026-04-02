# Invoice Payment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invoice "Pay" button's link-based flow with an in-modal payment experience that auto-detects crypto vs fiat, pre-fills fields, shows balances, and confirms before executing.

**Architecture:** One new component (`PayInvoiceModal`) and one modified component (`InvoiceTable`). The modal calls existing `/api/transfers` or `/api/payments` endpoints depending on the invoice currency. No new API routes needed.

**Tech Stack:** Next.js 14, React, TanStack Query, Zod, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-02-invoice-payment-flow-design.md`

---

## File Structure

### New Files
- `src/components/invoices/PayInvoiceModal.tsx` — Full payment modal

### Modified Files
- `src/components/invoices/InvoiceTable.tsx` — Replace old pay dialog with PayInvoiceModal, remove Link imports

---

## Task 1: Create PayInvoiceModal

**Files:**
- Create: `src/components/invoices/PayInvoiceModal.tsx`

- [ ] **Step 1: Create the component**

Read these files first for patterns and available hooks:
- `src/components/invoices/InvoiceTable.tsx` — the existing pay modal to replace
- `src/components/scheduled/ApprovalModal.tsx` — confirmation step pattern
- `src/components/transfers/SendTransferForm.tsx` — wallet selector pattern
- `src/components/payments/SendPaymentForm.tsx` — bank account selector + fiat destination fields pattern
- `src/hooks/useWallets.ts` — wallet selector hook
- `src/hooks/useBalances.ts` — `useWalletTokenBalance` for showing crypto balance
- `src/types/database.ts` — Invoice interface (has currency, token, chain, destination_address, vendor, erp_config)

Create `src/components/invoices/PayInvoiceModal.tsx`:

```typescript
'use client';
```

**Props:**
```typescript
interface PayInvoiceModalProps {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Component logic:**
- Determine `isCrypto` from `isStablecoin(invoice.currency ?? invoice.token ?? '')` — USDC/USDT = crypto, USD/EUR/GBP = fiat
- State: `confirmStep` (boolean), `executing` (boolean)
- For crypto: `walletId` state, wallet selector from `useWallets()`, balance from `useWalletTokenBalance(walletId, token)`
- For fiat: `bankAccountId` state, bank account selector from query to `/api/bank-accounts`, show account balance
- Destination: `destinationAddress` state, pre-filled from `invoice.destination_address ?? invoice.vendor?.wallet_address ?? ''`
- For fiat destination when empty: `toBankName`, `toAccountHolder`, `toAccountNumber`, `toRoutingNumber` states
- ERP config: `erpConfigId` state, pre-filled from `invoice.erp_config?.id ?? ''`, dropdown of active configs from query to `/api/erp/connect`
- Memo: pre-filled with `Invoice {invoice_number} — {vendor_name}`
- Reset all state when modal opens (useEffect on `open` + `invoice?.id`)

**Modal JSX structure:**

1. **Invoice summary** — read-only card showing invoice #, vendor, amount + currency, due date

2. **Funding source** — conditional:
   - Crypto: wallet Select dropdown with balance hint
   - Fiat: bank account Select dropdown with balance display

3. **Destination** — conditional:
   - If `destinationAddress` is pre-filled: show as read-only text
   - If empty + crypto: Input for wallet address
   - If empty + fiat: 4 Inputs (bank name, account holder, account number, routing number)

4. **ERP recording** — Select dropdown: "None" + active ERP configs. Pre-selected if invoice has erp_config.

5. **Memo** — Input, pre-filled, editable

6. **Footer** — two-step:
   - Step 1: "Cancel" + "Pay {amount} {currency}" button (disabled until source selected + destination filled)
   - Step 2 (confirmStep=true): confirmation text + "Go Back" / "Confirm Payment" buttons

**On confirm:**
- If crypto: POST to `/api/transfers` with `{ fromWalletId, toAddress, chain: selectedWallet.chain, token: invoice.currency or invoice.token, amount: invoice.amount, memo, invoiceId: invoice.id, erpConfigId }`
- If fiat: POST to `/api/payments` with `{ fromBankAccountId, toBankName, toAccountNumber, toRoutingNumber, toAccountHolder, amount: invoice.amount, currency: invoice.currency, memo, invoiceId: invoice.id }`
- On success: toast, invalidate `['invoices']` + `['transfers']` or `['fiat-payments']`, close modal
- On error: toast error, stay on confirm step

- [ ] **Step 2: Commit**

```bash
git add src/components/invoices/PayInvoiceModal.tsx
git commit -m "feat: add PayInvoiceModal with crypto/fiat auto-detection"
```

---

## Task 2: Update InvoiceTable

**Files:**
- Modify: `src/components/invoices/InvoiceTable.tsx`

- [ ] **Step 1: Replace the old pay dialog**

Read `src/components/invoices/InvoiceTable.tsx`. Make these changes:

1. Import `PayInvoiceModal` from `./PayInvoiceModal`
2. Remove the `Link` import from `next/link` (no longer needed)
3. Remove the `isStablecoin` helper function (moved to PayInvoiceModal)
4. Find the `{/* Pay Invoice Modal */}` Dialog block (lines ~297-362) — delete the entire Dialog
5. Add `<PayInvoiceModal invoice={payInvoice} open={!!payInvoice} onOpenChange={(o) => !o && setPayInvoice(null)} />` in its place
6. In the invoice detail modal, update the "Pay Invoice" button at the bottom to set `payInvoice` and close the detail modal:
   ```tsx
   onClick={() => { setSelectedInvoice(null); setPayInvoice(selectedInvoice); }}
   ```
   (This should already be the case — verify it matches)

- [ ] **Step 2: Commit**

```bash
git add src/components/invoices/InvoiceTable.tsx
git commit -m "feat: replace invoice pay dialog with PayInvoiceModal"
```

---

## Task 3: Build Verification

- [ ] **Step 1: Run the build**

```bash
cd C:/Users/John/crypto-treasury && npx next build
```

Fix any TypeScript errors.

- [ ] **Step 2: Verify**

Navigate to `/invoices`:
- Click "Pay" on an unpaid invoice — should open PayInvoiceModal
- Click into an invoice detail → "Pay Invoice" — should open PayInvoiceModal
- Modal should show correct funding source type based on currency

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from invoice payment flow"
```
