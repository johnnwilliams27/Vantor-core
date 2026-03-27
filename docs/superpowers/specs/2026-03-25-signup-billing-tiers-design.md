# Vantor Signup, Billing & Account Tiers Design

**Date:** 2026-03-25
**Status:** Draft
**Author:** Lead Developer + Claude

---

## Overview

Implement a complete signup, subscription billing, and account tier system for Vantor. This includes five account tiers (Lite through Enterprise), Stripe-based billing, Persona KYC/KYB, transaction fees, admin invitations, and a billing management UI.

**Architecture approach:** Hybrid — Stripe manages subscriptions and payments, the app owns feature gating logic. A `subscription_tier` enum on the enterprise table drives all gating decisions, kept in sync by Stripe webhooks.

**Key design decisions:**
- `subscriptions.tier` is the source of truth; `enterprises.subscription_tier` is a denormalized cache for fast gating. Webhook handlers update both in a single DB transaction.
- All webhook endpoints (Stripe, Persona) verify signatures using raw request bodies and reject unverified payloads.
- Webhook handlers are idempotent — processed event IDs are stored and deduplicated.

---

## 1. Tier Definitions & Feature Gating

### Tier Configuration

Defined as a constant in `src/lib/billing/tiers.ts`:

| Tier | Price | Live Mode | Asset Cap | Included ERPs (live) | KYC Required | KYB Required | Credit Card Required |
|------|-------|-----------|-----------|----------------------|--------------|--------------|---------------------|
| `lite` | $0 | No | N/A | 0 | No | No | No |
| `starter` | $950/mo | Yes | $2M | 1 | Yes | Yes | Yes |
| `growth` | $2,000/mo | Yes | $10M | 1 | Yes | Yes | Yes |
| `scale` | $5,000/mo | Yes | $20M | 1 | Yes | Yes | Yes |
| `enterprise` | Custom | Yes | Unlimited | 1 | Yes | Yes | Yes |

- Enterprise tier has no fixed price — displayed as "Contact Us" in the UI.
- Enterprise pricing is set per-customer by an app admin via Stripe ad-hoc pricing.
- Additional ERP integrations beyond the included 1 cost $1,500/mo each (paid tiers only).
- One-per-provider constraint remains (max one SAP, one Oracle, one Xero, one NetSuite). Billing is based on total live ERP count across providers.

### Feature Gating

Module: `src/lib/billing/gate.ts`

- `canAccessLiveMode(tier)` — returns false for `lite`
- `getAssetCap(tier)` — returns dollar threshold (null for enterprise/unlimited)
- `isAtAssetCap(enterpriseId)` — sums all live wallet balances + bank account balances + yield protocol positions, compares to cap
- `canAddErp(enterpriseId)` — checks current live ERP count vs included 1 + paid add-ons

Tier is read from `subscription_tier` on the enterprise record, cached in the session JWT for fast client-side checks.

### Asset Cap Behavior

- **What counts:** Total value of all connected live wallets + bank account balances + yield protocol positions
- **Hard block** when at or above cap: all actions blocked except viewing data and upgrading
- **Persistent banner:** "You've reached your asset cap. Upgrade to continue." with upgrade button linking to `/settings/billing`

### Test Mode

- All tiers get identical test mode with $5M seed data (auto-provisioned)
- Lite users: live mode toggle is disabled with tooltip "Upgrade to a paid plan to access live mode"
- 0.1% Vantor transaction fees do NOT apply in test mode

---

## 2. Database Schema Changes

### New Enum

`subscription_tier` — `lite`, `starter`, `growth`, `scale`, `enterprise`

### New Tables

#### `subscriptions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enterprise_id` | uuid FK → enterprises | unique |
| `stripe_customer_id` | text | Stripe customer ID |
| `stripe_subscription_id` | text | nullable (Lite has no subscription) |
| `tier` | enum `subscription_tier` | lite, starter, growth, scale, enterprise |
| `status` | text | active, past_due, canceled, trialing |
| `custom_price` | numeric | nullable — only for enterprise tier, per-customer pricing |
| `current_period_start` | timestamptz | |
| `current_period_end` | timestamptz | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `payment_methods`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enterprise_id` | uuid FK → enterprises | |
| `stripe_payment_method_id` | text | |
| `card_brand` | text | visa, mastercard, etc. |
| `card_last4` | text | |
| `card_exp_month` | int | |
| `card_exp_year` | int | |
| `is_default` | boolean | |
| `created_at` | timestamptz | |

#### `erp_addons`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enterprise_id` | uuid FK → enterprises | |
| `erp_configuration_id` | uuid FK → erp_configurations | |
| `stripe_subscription_item_id` | text | add-on line item in Stripe |
| `monthly_cost` | numeric | 1500.00 |
| `active` | boolean | |
| `created_at` | timestamptz | |

#### `usage_fees`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enterprise_id` | uuid FK → enterprises | |
| `transaction_type` | text | ramp, swap, bridge |
| `transaction_id` | uuid | FK to respective table |
| `notional_amount` | numeric | base transaction amount in USD |
| `fee_rate` | numeric | 0.001 (0.1%) |
| `fee_amount` | numeric | calculated fee |
| `billing_period` | date | 1st of billing month, e.g., 2026-03-01 |
| `created_at` | timestamptz | |

#### `webhook_events`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `source` | text | stripe, persona |
| `event_id` | text unique | external event ID for deduplication |
| `event_type` | text | e.g., invoice.paid, inquiry.completed |
| `processed_at` | timestamptz | |
| `created_at` | timestamptz | |

#### `invitations`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `email` | text | invitee email |
| `invited_by` | uuid FK → user_profiles | must be is_app_admin |
| `inviter_email` | text | denormalized for audit trail |
| `token` | text unique | signup link token |
| `status` | text | pending, accepted, expired |
| `expires_at` | timestamptz | 7 days from creation |
| `created_at` | timestamptz | |

#### `kyc_verifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enterprise_id` | uuid FK → enterprises | |
| `user_id` | uuid FK → user_profiles | |
| `persona_inquiry_id` | text | Persona inquiry ID |
| `status` | text | pending, completed, failed, expired |
| `completed_at` | timestamptz | |
| `created_at` | timestamptz | |

#### `kyb_verifications`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `enterprise_id` | uuid FK → enterprises | unique |
| `persona_inquiry_id` | text | Persona KYB inquiry ID |
| `status` | text | pending, completed, failed, expired |
| `legal_entity_name` | text | |
| `completed_at` | timestamptz | |
| `created_at` | timestamptz | |

### Modifications to Existing Tables

- `enterprises`: add `subscription_tier` enum column (default `lite`) — denormalized cache for fast gating. Source of truth is `subscriptions.tier`. Webhook handlers update both in a single DB transaction. A reconciliation check on login verifies these stay in sync.
- `enterprises`: deprecate existing `kyc_status` column — replaced by `kyb_verifications` table. Migration sets existing `kyc_status` values to null and adds a comment marking it deprecated. New code reads from `kyb_verifications` only.

---

## 3. Signup & Onboarding Flows

### Flow A: Self-Serve Signup (Landing Page)

1. User clicks "Get Started" → `/register`
2. User provides: full name, email, password, company name
3. Registration API (`POST /api/auth/register`) now performs:
   a. Creates Supabase auth user (existing)
   b. Creates enterprise row with `name` = company name, `subscription_tier` = `lite`
   c. Creates test enterprise (linked via `test_enterprise_id`) for test mode
   d. Creates `subscriptions` row with `tier: 'lite'`, no Stripe IDs
   e. Sets `user_profiles.enterprise_id` to the new enterprise
   f. Sets `user_profiles.role` to `treasury_manager` (first user is the admin)
   g. Calls `seedTestEnterprise(testEnterpriseId)` to provision seed data
4. User lands on dashboard in test mode
5. Prominent upgrade CTA in sidebar and dashboard

### Flow B: Admin Invite

1. App admin (`is_app_admin`) goes to admin panel → "Invite User" section
2. Enters email → POST `/api/admin/invitations`
3. Invitation record created with unique token (expires 7 days)
4. Branded light-theme email sent via Resend (Vantor logo, teal accents, light background)
5. Link: `/register?invite={token}` — pre-fills email, skips tier selection
6. User provides: full name, password, company name (email pre-filled)
7. Registration creates a new enterprise at Lite tier for the invited user (same flow as self-serve — each invite creates an independent enterprise)
8. Same seed data provisioning → lands on dashboard
9. Upgrade CTA available when ready

### Upgrade Flow (Lite → Paid Tier)

1. Treasury manager selects target tier in `/settings/billing`
2. For Enterprise: "Contact Us" CTA instead of checkout
3. **KYB flow** (if enterprise hasn't completed KYB): Persona KYB embedded flow — legal entity, beneficial ownership (FinCEN BOI), purpose, expected transaction patterns
4. **KYC flow** (if treasury manager hasn't completed KYC): Persona KYC embedded flow
5. Both must be `completed` before Stripe checkout is presented
6. Stripe Checkout / embedded payment form for credit card
7. Card saved → Stripe subscription created → webhook fires → `subscription_tier` updated
8. Live mode unlocked

---

## 4. KYC/KYB Requirements

### KYB (Know Your Business) — Per Enterprise

- One-time requirement at first upgrade from Lite to any paid tier
- Collected via Persona KYB flow: legal entity name, registration number, jurisdiction, beneficial ownership, business purpose, expected transaction patterns/volumes
- Stored in `kyb_verifications` table
- Must be `completed` before payment is accepted
- Only needs to happen once per enterprise

### KYC (Know Your Customer) — Per User

- **Treasury manager upgrading:** completes KYC as part of upgrade flow (KYB → KYC → Stripe)
- **Existing Lite users after enterprise upgrades:** on next login, redirected to `/kyc-required` — full-screen KYC gate, no app access until completed
- **New users added to paid-tier enterprise:** must complete KYC during signup/first login
- **Lite-tier users:** no KYC required

### KYC Provider: Persona

- Hosted Inquiry flow embedded in modal/page
- Persona webhooks update `kyc_verifications` and `kyb_verifications` status
- Webhook endpoint: POST `/api/webhooks/persona`

---

## 5. Transaction Fees

### Vantor Fee: 0.1% (Live Mode Only)

Applied on top of partner/network fees for:
- **Ramps** (on/off): 0.1% of fiat amount
- **Swaps**: 0.1% of from_amount (USD value)
- **Bridges**: 0.1% of transfer amount (USD value)

### Fee Display in Transaction Flows

Quote screens show line-item breakdown:
- Amount
- Partner fee (labeled by source, e.g., "MoonPay fee")
- Vantor fee (0.1%)
- **Total cost**
- **Net amount received**

Fees are deducted from the received amount (subtractive model):

Example (on-ramp, $10,000 USD → USDC):
```
You pay:            $10,000.00
MoonPay fee:           -$15.00  (0.15%)
Vantor fee:            -$10.00  (0.10%)
You receive:      ~9,975 USDC
```

### Fee Recording

- On successful execution, a `usage_fees` row is created
- `billing_period` field (e.g., "2026-03") for monthly aggregation
- Fees reported to Stripe as metered usage or injected as invoice line items before finalization

### Transaction Detail View

New component `TransactionDetailModal` — accessible by clicking any transaction row:
- Transaction type, status, timestamp
- From/to details (accounts, wallets, tokens, chains)
- Amount breakdown: notional, partner fee, Vantor fee, total, net received
- Transaction hash (if on-chain)
- Related metadata

### Changes to Existing Flows

- Quote API responses (`/api/ramps/quote`, `/api/swaps/quote`, `/api/bridges/quote`): add `vantor_fee` field
- Quote UI components (`RampForm.tsx`, `SwapForm.tsx`, `ChainSwapForm.tsx`): add Vantor fee line item
- Execute API routes: create `usage_fees` record on successful execution

---

## 6. Billing Settings UI

### Route: `/settings/billing`

Accessible to `treasury_manager` role only. New sidebar entry under Settings: "Billing".

### Tab 1: Plan

- Current tier card with plan name, price, status badge
- Lite: prominent "Upgrade to unlock live mode" CTA
- Paid tiers: tier comparison grid, current tier highlighted
- Upgrade button (higher tiers) → KYB/KYC/Stripe flow
- Downgrade button (lower tiers) → only enabled if connected assets < target tier's cap. Takes effect at next billing cycle.
- Enterprise: shows custom price, "Contact us to modify" note
- Asset cap usage bar: "Using $1.2M of $2M"

### Tab 2: Usage

- Current billing period
- Summary cards:
  - Subscription cost (pro-rated if mid-cycle change)
  - ERP add-on costs (count x $1,500)
  - Transaction fees by type (ramps/swaps/bridges: count + amount)
  - **Total estimated bill**
- Real-time from `usage_fees` table

### Tab 3: Invoices

- Table of past monthly invoices (from Stripe)
- Columns: Period, Amount, Status (paid/failed), Date
- Download PDF button per invoice (one-page summary bill)
- CSV export of full invoice list

### Tab 4: Payment Method

- Current card: brand icon, •••• last4, expiry
- "Update card" → Stripe-hosted card update or embedded Elements
- Lite: empty state — "Add a payment method when you upgrade"

---

## 7. Monthly Billing & Invoicing

### Billing Cycle

- All enterprises billed on the 1st of each month
- Stripe subscriptions anchored to `billing_cycle_anchor` on the 1st
- Stripe handles charge attempts, retries, and dunning

### Monthly Bill PDF (One Page)

Generated via `@react-pdf/renderer`, sent via Resend to treasury_manager email.

Layout:
- Vantor logo + company info header
- Bill-to: enterprise legal name, billing period
- Line items:
  - Subscription: [Tier name] — $X
  - ERP add-ons: [count] additional ERPs — $X
  - Transaction fees:
    - Ramps: [count] transactions — $X
    - Swaps: [count] transactions — $X
    - Bridges: [count] transactions — $X
  - **Total: $X**
- Payment method: •••• last4
- Footer: "For detailed transaction records, log in to app.vantor.xyz"

### Generation Flow

1. Stripe `invoice.paid` webhook fires on the 1st
2. Handler aggregates `usage_fees` for billing period + subscription + add-ons
3. PDF generated via `@react-pdf/renderer`
4. PDF sent to treasury_manager email via Resend
5. PDF stored in Supabase storage or retrieved on-demand

### Usage Fee Reporting to Stripe

Uses the `invoice.created` webhook approach:

1. Stripe fires `invoice.created` webhook before finalization
2. Webhook handler sets `auto_advance: false` on the invoice to prevent premature finalization
3. Handler queries `usage_fees` where `billing_period` matches and `created_at` < billing cutoff (1st of month, 00:00 UTC)
4. Aggregates fees by type (ramps, swaps, bridges) and adds as invoice line items via `stripe.invoiceItems.create()`
5. Finalizes the invoice via `stripe.invoices.finalizeInvoice()`
6. Any transactions completed after the cutoff roll into the next billing period

This avoids the complexity of metered billing and gives full control over line item presentation.

### Pro-Rata on Upgrade

- Handled natively by Stripe — credit for unused old plan time, charge for new plan pro-rated
- No custom logic needed

### Downgrade

- Takes effect at end of current billing period (`proration_behavior: 'none'`)
- Pre-conditions before allowing downgrade:
  1. Connected live assets must be below target tier's asset cap
  2. Live ERP count must be within target tier's allowance (1 included + paid add-ons). If user has extra ERPs, they must remove them or accept continued add-on billing.
  3. **Downgrade to Lite:** live data (wallets, bank accounts, live ERPs) is preserved but becomes inaccessible — user is locked to test mode only. If they re-upgrade, live data becomes accessible again. No data is deleted.

---

## 8. Seed Data Provisioning

> **Note:** This replaces the existing seed data in `src/lib/test-mode/helpers.ts` which creates smaller balances (~$160K wallets, ~$870K bank accounts). The new seed function provisions the full $5M as specified below.

Triggered on every new enterprise creation (all tiers).

### Test Mode Reserves ($5M Total)

| Type | Details | Balance |
|------|---------|---------|
| Bank Account | USD Checking — "Test Bank of America" | $1,500,000 |
| Bank Account | GBP Checking — "Test Barclays UK" | £500,000 |
| Bank Account | EUR Checking — "Test Deutsche Bank" | €500,000 |
| Wallet | Ethereum — USDC | $1,500,000 |
| Wallet | Solana — USDT | $500,000 |

### Test ERP Integrations (2)

- "Test SAP S/4HANA" — pre-configured, marked as test
- "Test Oracle NetSuite" — pre-configured, marked as test

### Implementation

- `src/lib/test-mode/seed.ts` — `seedTestEnterprise(enterpriseId)` creates all records against the test enterprise
- Called during registration and when creating test enterprises for paid tier upgrades
- All seeded records tagged with the test enterprise ID (existing multi-tenancy pattern)
- Lite users can create additional dummy integrations in test mode but cannot connect live ones

---

## 9. ERP Add-On Flow

### Add-On Trigger

When a paid-tier user adds a 2nd+ live ERP:

1. User clicks "Add ERP" in live mode at `/settings/erp`
2. System checks: is enterprise at included ERP count (1)?
3. If yes → confirmation modal:
   - "Adding an additional ERP integration costs $1,500/month. This will be added to your next bill, pro-rated for the remaining days this month."
   - "Cancel" / "Agree & Add"
4. On confirm → Stripe subscription item added → `erp_addons` record created → ERP setup proceeds
5. On removal → Stripe item removed → `erp_addons` deactivated → pro-rated credit via Stripe

### Constraints

- One-per-provider constraint remains (max one SAP, one Oracle, one Xero, one NetSuite)
- Billing based on total live ERP count across all providers
- Lite tier: 0 live ERPs (test ERPs only)

---

## 10. Login & Access Control

### Access Matrix

| State | Behavior |
|-------|----------|
| Lite user, normal login | Dashboard in test mode, live toggle disabled |
| Lite user, clicks live toggle | Tooltip: "Upgrade to a paid plan to access live mode" |
| Paid tier, KYB not complete | Cannot complete upgrade — treasury_manager must finish KYB first |
| Paid tier, KYB complete, user KYC not complete | Redirected to `/kyc-required` on login, no app access |
| Paid tier, KYB complete, user KYC complete | Full access, test/live toggle enabled |
| Paid tier, at asset cap | View data + billing only, all other actions blocked, persistent banner |
| Paid tier, subscription past_due | Warning banner with "Update payment method" link |
| Paid tier, subscription canceled | Downgraded to Lite behavior (test mode only) |

### Session JWT Additions

- `subscription_tier` — fast client-side gating
- `kyc_status` — enforce KYC gate without extra DB calls
- `kyb_status` — enterprise-level, for upgrade flow checks

### JWT Refresh Strategy

Stripe/Persona webhooks update the DB server-side but cannot push JWT refreshes to the client. To keep the JWT in sync:

1. **During upgrade/KYC flows:** After the user completes a KYB/KYC/payment step in the UI, the client immediately calls `useSession().update()` to trigger the NextAuth JWT callback, which re-reads from DB.
2. **On login:** JWT callback always reads fresh `subscription_tier`, `kyc_status`, and `kyb_status` from DB.
3. **Reconciliation on API calls:** Server-side API middleware checks `enterprises.subscription_tier` against the JWT value on each request. If they differ, the response includes a `x-session-stale: true` header, and the client auto-refreshes the session.

This avoids polling while ensuring the JWT stays reasonably fresh.

---

## 11. External Integrations

### Stripe

- **Purpose:** Subscription billing, credit card management, invoicing, pro-rata, dunning
- **NPM package:** `stripe` (to be added)
- **Webhook endpoint:** POST `/api/webhooks/stripe`
- **Signature verification:** All webhooks verified via `stripe.webhooks.constructEvent()` using the webhook signing secret. Route must read raw body via `req.text()` before JSON parsing.
- **Idempotency:** Event IDs stored in `webhook_events` table; duplicate events are skipped.
- **Key events:** `invoice.paid`, `invoice.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `payment_method.attached`, `payment_method.detached`
- **Products:** One product per tier (Starter, Growth, Scale) with fixed prices. Enterprise product with per-customer ad-hoc prices. ERP add-on product at $1,500/mo.

### Persona

- **Purpose:** KYC (individual identity verification) and KYB (business verification with FinCEN BOI)
- **NPM package:** `persona` (to be added, or use REST API directly)
- **Webhook endpoint:** POST `/api/webhooks/persona`
- **Signature verification:** Persona webhooks verified via HMAC signature in the `Persona-Signature` header using the webhook secret.
- **Idempotency:** Event IDs stored in `webhook_events` table; duplicate events are skipped.
- **Flows:** Hosted Inquiry embedded in modal for KYC, hosted KYB flow for business verification

### Resend (Existing)

- **Additional use:** Monthly billing PDF emails, admin invitation emails
- **Templates:** Light-background branded HTML (Vantor logo, teal accents)

---

## 12. New Dependencies

```
stripe                  # Stripe Node.js SDK
@stripe/stripe-js       # Stripe.js for frontend (Elements, Checkout)
@stripe/react-stripe-js # React components for Stripe Elements
persona                 # Persona SDK (or direct REST API)
```

---

## 13. New API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/stripe` | POST | Stripe webhook handler |
| `/api/webhooks/persona` | POST | Persona webhook handler |
| `/api/billing/subscription` | GET | Get current subscription/tier |
| `/api/billing/subscription` | POST | Create/upgrade subscription |
| `/api/billing/subscription` | PATCH | Downgrade subscription |
| `/api/billing/usage` | GET | Get current period usage fees |
| `/api/billing/invoices` | GET | List past invoices |
| `/api/billing/invoices/[id]/pdf` | GET | Download invoice PDF |
| `/api/billing/payment-method` | GET | Get current payment method |
| `/api/billing/payment-method` | POST | Create Stripe setup intent |
| `/api/billing/checkout` | POST | Create Stripe checkout session |
| `/api/billing/asset-cap` | GET | Get current asset total vs cap |
| `/api/kyc/start` | POST | Start Persona KYC inquiry |
| `/api/kyc/status` | GET | Get KYC status for current user |
| `/api/kyb/start` | POST | Start Persona KYB inquiry |
| `/api/kyb/status` | GET | Get KYB status for enterprise |
| `/api/admin/invitations` | POST | Send invite (is_app_admin only) |
| `/api/admin/invitations` | GET | List invitations |
| `/api/admin/enterprise/[id]/plan` | PATCH | Set enterprise custom price (is_app_admin) |

### Rate Limiting

Apply rate limiting (using existing `src/lib/api/rate-limit.ts`) to public-facing endpoints:
- `/api/auth/register` — prevent signup abuse
- `/register?invite={token}` — prevent invitation token brute-force
- `/api/webhooks/*` — basic protection (signatures are primary defense)

### Security Notes

- Enterprise tier "Contact Us" flow opens a pre-filled contact form (mailto or embedded form to existing `/api/contact` endpoint) — no self-serve checkout for Enterprise.
- All billing API routes require `treasury_manager` role check.
- Admin routes (`/api/admin/*`) require `is_app_admin` check.
- Stripe webhook routes must skip CSRF/auth middleware but enforce signature verification.
