# Test Mode Seed Data & Tier Transition Design

## Overview

Ensure every test mode enterprise gets comprehensive dummy data on creation, and define the transition behavior when upgrading from Lite to a paid tier.

**Two distinct test mode experiences:**

- **Lite test mode** — full demo showcase with rich dummy data across all features, so users see what Vantor looks like fully loaded
- **Paid tier test mode (Starter+)** — clean developer sandbox where users connect their own sandbox wallets, bank accounts, and integrations. Data persists across all paid tier transitions.

## Data Model Changes

### Migration: `0016_kyc_kyb_persistence.sql`

**`enterprises` table — new columns:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `kyb_status` | text (check: `not_started`, `pending`, `completed`, `failed`) | `'not_started'` | Fast KYB status lookup for upgrade flow resume |
| `kyb_completed_at` | timestamptz | null | Timestamp of KYB completion |
| `test_data_wiped_at` | timestamptz | null | Set when demo data wiped on upgrade; prevents double-wipes |

**`users` table — new columns:**

| Column | Type | Default | Purpose |
|---|---|---|---|
| `kyc_status` | text (check: `not_started`, `pending`, `completed`, `failed`) | `'not_started'` | Fast KYC status lookup for upgrade flow resume |
| `kyc_completed_at` | timestamptz | null | Timestamp of KYC completion |

Text + check constraint chosen over Postgres enum for easier evolution. These are denormalized caches — the `kyb_verifications` and `kyc_verifications` tables (migration 0015) remain the source of truth for Persona inquiry details.

RLS: Inherits existing row-level security on both tables. PATCH endpoints use admin client for writes.

## Seed Data Modules

### Directory: `src/lib/test-mode/seed/`

Each module exports an async function `seed<Domain>(supabase, enterpriseId)` that inserts domain-specific demo data. All modules reference `scripts/seed.ts` for data shapes and volumes.

| File | What it seeds | Approximate volume |
|---|---|---|
| `wallets.ts` | Wallets + balances + 180 days of balance snapshots | 5 wallets, ~1,800 snapshots |
| `banking.ts` | Bank accounts + fiat transactions (on/off ramp) | 6 banks, ~20 fiat txns |
| `erp.ts` | ERP configs + vendors + invoices + GL postings | 2 ERPs, 12+ vendors, 18 invoices, GL entries |
| `transactions.ts` | On-chain transactions + payments + payment attempts | 30+ txns, 30+ payments |
| `swaps.ts` | Token swap records | 8-10 swaps |
| `bridges.ts` | Cross-chain bridge transfers | 5-6 bridges |
| `treasury.ts` | Treasury rules + obligations + AI recommendations + forecasts + simulation runs | 1 rule, 30+ obligations, 12 recommendations |
| `yield.ts` | Yield positions + yield transactions | 3-4 positions, 8-10 yield txns |
| `compliance.ts` | Sanctions screenings + KYT transfers + KYT alerts + travel rule records | 10+ screenings, 10+ KYT, 5+ alerts, 5+ travel rule |
| `audit.ts` | Audit log entries | 20+ entries |
| `seed-all.ts` | Orchestrator — calls all modules in dependency order | — |

### Dependency order in `seed-all.ts`:

1. `wallets` + `banking` + `erp` (no deps)
2. `transactions` + `swaps` + `bridges` (reference wallets/banks)
3. `treasury` (references wallets)
4. `yield` (references wallets)
5. `compliance` (references wallets/transactions)
6. `audit` (references everything)

### Data characteristics:

- All records scoped to `enterprise_id`
- Dates span 90 days back from creation time
- Realistic amounts, statuses, and distributions (mix of completed/pending/failed)
- Wallet addresses use obvious test prefixes (`0xTEST...`, `TESTso1...`)
- Token mix: USDC and USDT across Ethereum and Solana (no PYUSD)

## Wipe Logic

### File: `src/lib/test-mode/seed/wipe.ts`

Exports `wipeTestEnterprise(supabase, testEnterpriseId)`:

1. Validates `is_test_enterprise = true` on the enterprise record — refuses to wipe real enterprises
2. Deletes all records scoped to the test enterprise ID in reverse dependency order:
   - `audit_logs`
   - `sanctions_screenings`, `kyt_transfers`, `kyt_alerts`, `travel_rule_transfers`
   - `yield_transactions`, `yield_positions`
   - `simulation_runs`, `treasury_forecasts`, `ai_recommendations`, `manual_obligations`, `treasury_rules`
   - `bridge_transfers`
   - `swaps`
   - `payment_attempts`, `payments`, `transactions`
   - `gl_postings`, `invoices`, `erp_vendors`, `erp_configurations`
   - `fiat_transactions`, `bank_accounts`
   - `balance_snapshots`, `wallet_balances`, `wallets`
3. Sets `enterprises.test_data_wiped_at = now()` on the test enterprise
4. Returns success/failure

## Upgrade Flow Changes

### Modified `UpgradeFlow.tsx`

Current steps: KYB → KYC → Checkout

New steps: KYB → KYC → Sandbox Warning → Checkout

**Step resolution on open:**

1. Check `enterprise.kyb_status` — if `completed`, skip KYB
2. Check `user.kyc_status` — if `completed`, skip KYC
3. If both complete, go straight to Sandbox Warning
4. If all three acknowledged, go straight to Checkout

**Sandbox Warning step (new):**

- Headline: "Your test environment will change"
- Body: "When you upgrade, your test mode demo data will be cleared and replaced with a clean developer sandbox. You'll connect your own sandbox wallets, bank accounts, and integrations for testing."
- Checkbox: "I understand my demo data will be removed"
- Continue button disabled until checkbox checked
- Proceeds to Stripe checkout on continue

**KYB persistence:**

When Persona KYB inquiry completes in `PersonaKybFlow.tsx`, call `PATCH /api/billing/kyb-status` to set `kyb_status = 'completed'` and `kyb_completed_at = now()` on the enterprise.

**KYC persistence:**

When Persona KYC inquiry completes in `PersonaKycFlow.tsx`, call `PATCH /api/billing/kyc-status` to set `kyc_status = 'completed'` and `kyc_completed_at = now()` on the user.

**Resume banner on Settings > Billing PlanTab:**

- KYB complete, KYC not complete: "Business verification complete — continue with identity verification"
- KYB + KYC both complete, still Lite: "Verification complete — finish your upgrade"
- CTA opens upgrade flow at the correct remaining step

**KYC display:** Surface KYC status on the user's Settings > Profile page.

**Wipe trigger:** After Stripe checkout succeeds in `POST /api/billing/subscription`, call `wipeTestEnterprise()`. Wipe only happens on successful payment.

## API Endpoints

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/billing/kyb-status` | Persist KYB completion on enterprise |
| `PATCH` | `/api/billing/kyc-status` | Persist KYC completion on user |

Both validate session user/enterprise and update the respective record. Called from Persona flow components on verification success.

### Modified endpoints

| Method | Path | Change |
|---|---|---|
| `POST` | `/api/auth/register` | Call `seedAll()` instead of `seedTestEnterprise()` |
| `POST` | `/api/billing/subscription` | After successful Stripe checkout, call `wipeTestEnterprise()` on the test enterprise |
| `POST` | `/api/test-mode/toggle` | Skip seeding if `test_data_wiped_at` is set on the test enterprise |

## Feature Gating

No changes to `src/lib/billing/gate.ts`. Existing gates restrict live mode access, asset caps, and ERP limits — they do not hide features or pages. Demo data is visible in test mode regardless of tier, and paid sandbox data is user-generated.
