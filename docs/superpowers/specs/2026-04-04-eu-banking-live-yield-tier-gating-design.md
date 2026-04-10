# International Banking, Live Yield Data & Tier Gating

**Date:** 2026-04-04
**Status:** Draft

---

## Overview

This spec covers seven interconnected changes:

1. **TrueLayer integration** — European bank account linking and balance reads (AIS only)
2. **Belvo integration** — Brazilian and Mexican bank account linking and balance reads
3. **BRL/MXN currency support** — Add Brazilian Real and Mexican Peso throughout the app, seed data, FX rates, and formatting
4. **Live yield protocol data** — Replace mock APYs with real rate fetching for all 11 protocols (10 existing + Compound V3)
5. **Ondo USDY gating** — Non-US-only visibility, external KYC flow with on-chain verification
6. **Lite tier gate** — Block all execute/link actions for Lite users with upgrade CTA
7. **Environment mode cleanup** — Standardize dev=sandbox, prod=mock/sandbox/live per customer tier

---

## 1. Enterprise Country via Persona KYB

### Problem

No `country` field on enterprises. Needed to route TrueLayer vs Plaid and gate Ondo USDY visibility.

### Design

- Add `country` column to `enterprises` table — ISO 3166-1 alpha-2 (e.g., `US`, `DE`, `GB`), nullable
- Populate from Persona KYB webhook payload when `inquiry.completed` fires — extract registered business country from the inquiry attributes
- Update webhook handler at `/api/webhooks/persona/route.ts` to read country from the KYB inquiry and store on the enterprise row
- Country is `NULL` for Lite tier (no KYB required) — this is intentional; Lite users can't execute anything anyway

### Database Migration

```sql
ALTER TABLE enterprises ADD COLUMN country TEXT;
-- ISO 3166-1 alpha-2, e.g., 'US', 'DE', 'GB'
-- NULL until KYB is completed
```

---

## 2. Stripe Financial Connections (US + EU Bank Linking)

### Problem

Need bank account linking for US and EU enterprises. Previously used Plaid (US only) — replacing with Stripe Financial Connections which covers both US and EU corporate banks through a single integration. Stripe is already in the stack (billing, payments).

### Design

Stripe Financial Connections provides account linking, balance reads, transaction history, and account verification. Covers major US and EU corporate banks. Combined with Belvo for Brazil/Mexico, this gives global coverage with just two providers. Bridge.xyz continues to handle all money movement (ramps, payments).

### Routing Logic

```
enterprise.country is NULL         → no bank linking (Lite tier, no KYB yet)
enterprise.country in BR, MX       → Belvo
enterprise.country (all others)    → Stripe Financial Connections
```

Stripe FC covers US, CA, UK, and major EU markets. For any country not covered by Belvo, default to Stripe FC. Manual entry fallback for unsupported banks.

### New Files

- `src/lib/banking/stripe-fc.ts` — Stripe Financial Connections client
  - `createSession(mode, permissions)` → creates a FinancialConnections.Session, returns client secret
  - `getAccount(accountId)` → fetches linked account details
  - `getAccountBalance(accountId)` → fetches current balance
  - `refreshAccountData(accountId)` → triggers balance/transaction refresh
- `src/app/api/bank-accounts/stripe-fc/session/route.ts` — creates FC session for frontend widget
- `src/app/api/bank-accounts/stripe-fc/link/route.ts` — handles account linked callback, creates bank_accounts row

### Database Changes

```sql
ALTER TABLE bank_accounts ADD COLUMN banking_provider TEXT NOT NULL DEFAULT 'manual'
  CHECK (banking_provider IN ('stripe_fc', 'belvo', 'manual'));

-- Stripe Financial Connections fields
ALTER TABLE bank_accounts ADD COLUMN stripe_fc_account_id TEXT;
ALTER TABLE bank_accounts ADD COLUMN iban TEXT;
```

Note: Existing `plaid_item_id` and `plaid_account_id` columns remain for backwards compatibility but are no longer used for new connections. Plaid and TrueLayer code will be removed.

### Plaid Removal

Remove all Plaid-specific code and dependencies:
- Delete: `src/lib/banking/plaid.ts`
- Delete: `src/app/api/bank-accounts/plaid/link-token/route.ts`
- Delete: `src/app/api/bank-accounts/plaid/exchange/route.ts`
- Remove: `react-plaid-link` and `plaid` npm packages
- Remove: `PLAID_*` env vars from `.env.local.example`
- Rename: `PlaidLinkButton.tsx` → `BankLinkButton.tsx` with Stripe FC + Belvo routing

### UI Changes

- `PlaidLinkButton.tsx` → rename to `BankLinkButton.tsx`
  - If country is BR/MX: Belvo widget flow
  - All other countries: Stripe Financial Connections widget (uses `@stripe/stripe-js` collectFinancialConnectionsAccounts)
  - If no country (Lite): show upgrade gate
  - Manual entry fallback for unsupported banks
- Balance refresh in `BankAccountsTab.tsx` → route by `banking_provider` field (`stripe_fc` or `belvo`)

### Environment Variables

No new env vars needed — Stripe Financial Connections uses the existing `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`.

---

## 3. Belvo Integration (Brazil & Mexico)

### Problem

No bank account linking for Brazilian or Mexican enterprises. Bridge.xyz supports BRL and MXN for ramps, but users can't connect their local bank accounts to view balances.

### Design

Belvo provides account linking, balance reads, and transaction history for Brazilian and Mexican banks. Similar role to Plaid (US) and TrueLayer (EU) — read-only account information. Bridge.xyz handles all money movement including BRL and MXN ramps (Pix for Brazil, SPEI for Mexico).

### New Files

- `src/lib/banking/belvo.ts` — Belvo API client
  - `createWidgetToken(mode)` → returns access token for Belvo Connect widget
  - `getAccounts(mode, linkId)` → fetches accounts for a link
  - `getAccountBalance(mode, linkId, accountId)` → fetches current balance
- `src/app/api/bank-accounts/belvo/widget-token/route.ts` — generates widget token for frontend
- `src/app/api/bank-accounts/belvo/link/route.ts` — handles link_id from widget callback, creates bank_accounts rows

### Database Changes

```sql
-- Add 'belvo' to banking_provider check constraint
-- Belvo provider already included in banking_provider check from Section 2

-- Belvo-specific fields
ALTER TABLE bank_accounts ADD COLUMN belvo_link_id TEXT;
ALTER TABLE bank_accounts ADD COLUMN belvo_account_id TEXT;
```

### UI Changes

- `BankLinkButton.tsx` — add Belvo flow alongside Plaid and TrueLayer
  - If country is BR or MX: show "Connect Bank via Belvo" button
  - Opens Belvo Connect widget (`@belvo/connect-widget`)
  - Widget returns `link_id` → call `/api/bank-accounts/belvo/link` to store accounts
- Balance refresh routes to Belvo API for `banking_provider === 'belvo'`

### Environment Variables

```
BELVO_SECRET_KEY_ID_SANDBOX=
BELVO_SECRET_KEY_PASSWORD_SANDBOX=
BELVO_SECRET_KEY_ID_LIVE=
BELVO_SECRET_KEY_PASSWORD_LIVE=
```

### npm Dependencies

```
@belvo/connect-widget  — Frontend widget (React)
```

Note: We'll use direct REST API calls instead of the `belvo-js` SDK to keep the backend consistent with our TrueLayer/Plaid pattern (fetch-based, no heavy SDK dependencies).

---

## 4. BRL/MXN Currency Support

### Problem

The app only supports USD, EUR, GBP. Brazilian and Mexican enterprises need BRL and MXN represented throughout — currency formatting, FX rates, seed data, forms, and displays.

### Changes

#### Currency Constants (`src/lib/fx/rates.ts`)

```typescript
export const SUPPORTED_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN'] as const;

const MOCK_RATES: Record<FiatCurrency, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  BRL: 5.05,
  MXN: 17.15,
};

const CURRENCY_SYMBOLS: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  BRL: 'R$',
  MXN: 'MX$',
};
```

Note: `formatFiatAmount()` already uses `Intl.NumberFormat` with the currency code, which handles BRL and MXN formatting correctly (e.g., `R$ 1.234,56` for Brazilian locale). The `getCurrencySymbol()` helper is only used for inline display where Intl isn't available.

#### Form Validation Updates

All Zod schemas that validate fiat currency need updating:
- `src/components/banking/RampForm.tsx` — `z.enum(['USD', 'EUR', 'GBP'])` → `z.enum(['USD', 'EUR', 'GBP', 'BRL', 'MXN'])`
- `src/components/banking/ScheduleRampForm.tsx` — same
- `src/components/payments/SendPaymentForm.tsx` — same
- `src/components/payments/SchedulePaymentForm.tsx` — same
- Any other forms with hardcoded currency enums

#### Seed Data Updates

Add Brazilian and Mexican bank accounts, transactions, and payments to test-mode seed data:

**Banking seed** (`src/lib/test-mode/seed/banking.ts`):
- Add: Itaú Unibanco BRL R$280,000
- Add: Nubank BRL R$95,000
- Add: BBVA Mexico MXN MX$1,500,000
- Add fiat transactions in BRL and MXN (on-ramps and off-ramps)

**Transactions seed** (`src/lib/test-mode/seed/transactions.ts`):
- Add BRL and MXN to the currency pool for fiat payments
- Add transfers with BRL/MXN amounts

**ERP seed** (`src/lib/test-mode/seed/erp.ts`):
- Add vendors with BRL/MXN invoices
- Add invoices denominated in BRL and MXN

**Invoice table** (`src/components/invoices/InvoiceTable.tsx`):
- Update `CURRENCIES` array to include BRL and MXN

---

## 5. Live Yield Protocol Data

### Problem

All yield rates are currently hardcoded mock APYs. Need live data from 11 protocols.

### Architecture

**Cron job** (Vercel Cron, every 60 seconds) fetches rates from all protocols in parallel and caches to a database table. The existing `/api/yield/rates` endpoint reads from the cache instead of mock adapters.

### New Cache Table

```sql
CREATE TABLE yield_rate_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol TEXT NOT NULL,
  token TEXT NOT NULL,
  chain TEXT NOT NULL,
  supply_apy NUMERIC NOT NULL,
  reward_apy NUMERIC NOT NULL DEFAULT 0,
  total_apy NUMERIC NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_stale BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(protocol, token, chain)
);
```

### Rate Fetchers

New directory: `src/lib/yield/rates/`

Each fetcher implements:
```typescript
interface RateFetcher {
  fetchRates(): Promise<{ protocol: string; token: string; chain: string; supplyAPY: number; rewardAPY: number }[]>;
}
```

| File | Protocol | Method | Details |
|---|---|---|---|
| `aave.ts` | Aave V3 | viem multicall | `Pool.getReserveData(asset)` → extract `currentLiquidityRate` (RAY-scaled, divide by 1e27). Use `@aave/math-utils` for APY conversion. Batch USDC + USDT in one multicall. |
| `compound.ts` | Compound V3 | viem read | `Comet.getUtilization()` → `Comet.getSupplyRate(utilization)`. Per-second rate × seconds-per-year. One Comet deployment per base asset. |
| `morpho.ts` | Morpho Blue + Steakhouse | GraphQL | POST to `https://blue-api.morpho.org/graphql`. Query `markets` for `supplyApy`. Filter by market IDs for USDC/USDT markets. |
| `sky.ts` | Sky sUSDS | viem read | `sUSDS.ssr()` returns per-second RAY rate. Annualize: `(ssr/1e27)^(365*24*3600) - 1`. Rate changes only via governance — can cache longer. |
| `ondo.ts` | Ondo USDY | viem read | `RWADynamicOracle.getPrice()` → derive daily accrual rate from price changes. Cache price, compare with previous day's price to estimate APY. |
| `ethena.ts` | Ethena sUSDe | REST | `GET https://ethena.fi/api/yields/protocol-and-staking-yield` → extract sUSDe APY. No auth required. |
| `maple.ts` | Maple Finance | GraphQL | POST to `https://api.maple.finance/v2/graphql`. Query pools for USDC lending pool APY. |
| `kamino.ts` | Kamino Lend + Multiply | REST | `GET https://api.kamino.finance/kamino-market/{address}/reserves` → extract supply APY per reserve. |
| `drift.ts` | Drift Earn | REST | `GET https://mainnet-beta.api.drift.trade/spotMarketRate` → extract lending rate for USDC market. |

### Cron Endpoint

`src/app/api/cron/yield-rates/route.ts`

- Authenticated via `CRON_SECRET` header (Vercel Cron pattern, already used elsewhere)
- Calls all fetchers in parallel via `Promise.allSettled()`
- Each successful result upserts to `yield_rate_cache`
- Each failed result sets `is_stale = true` on existing row (keeps last known rate)
- Logs failures for monitoring

### Vercel Cron Config

In `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/yield-rates",
    "schedule": "* * * * *"
  }]
}
```

### Existing Rate Endpoint Changes

`/api/yield/rates` currently calls `adapter.getAPY()` for each protocol (mock). Change to:
1. Read from `yield_rate_cache` table
2. Include `fetched_at` and `is_stale` in response
3. Fall back to mock APYs if cache is empty (first deployment, cron hasn't run yet)

### UI Changes

- `YieldRatesTable.tsx` — show "Rates as of [time]" with relative timestamp (e.g., "12s ago")
- If `is_stale = true` for a protocol, show amber "Stale" badge next to the rate
- If `fetched_at` is >5 minutes old across all protocols, show banner: "Rate data may be outdated"

### On-Chain Read Setup

For viem-based fetchers (Aave, Compound, Sky, Ondo), use the existing `ETHEREUM_RPC_URL` env var. Create a shared viem public client in `src/lib/yield/rates/client.ts`:

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETHEREUM_RPC_URL),
});
```

Contract addresses stored as constants in each fetcher file.

---

## 6. Add Compound V3

### Protocol Metadata

```
id: compound_v3
name: Compound V3
chain: ethereum
supportedTokens: ['USDC', 'USDT']
description: 'Battle-tested lending protocol. Supply stablecoins to the Comet market and earn yield from borrowers.'
riskLevel: low
riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 }
kycRequired: false
```

### Changes

- Add `'compound_v3'` to `YieldProtocolId` union in `src/lib/yield/interface.ts`
- Add metadata to `PROTOCOL_META` in mock adapter
- Add mock APY: `{ supply: 0.0440, reward: 0.0035 }` (4.40% supply + 0.35% COMP rewards)
- Add yield token: `cUSDCv3`
- Add slippage pool data: `{ tvl: 1_800_000_000, utilization: 0.80, poolType: 'stablecoin' }`
- Add Compound rate fetcher in `src/lib/yield/rates/compound.ts`
- Update `ALL_YIELD_PROTOCOLS` in factory

---

## 7. Ondo USDY — Non-US Gating & KYC

### Visibility Rule

Ondo USDY tile is only shown when:
- `enterprise.country` is set (KYB completed)
- `enterprise.country !== 'US'`

Implemented in `/api/yield/rates` — filter out Ondo from response when conditions aren't met. Also filter in UI as a safety net.

### KYC Tracking

New table:

```sql
CREATE TABLE ondo_kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(enterprise_id, wallet_address)
);
```

### API Routes

- `POST /api/yield/ondo/verify-kyc` — User claims they've completed Ondo KYC
  - Input: `{ walletAddress: string }`
  - Reads USDY allowlist contract on-chain: check if wallet is on the transfer whitelist
  - If whitelisted: upsert `ondo_kyc_verifications` with `status = 'verified'`
  - If not: return `{ verified: false, message: "Wallet not yet whitelisted by Ondo" }`
- `GET /api/yield/ondo/kyc-status` — Check KYC status for enterprise
  - Returns list of verified wallet addresses for the enterprise

### UI Flow

1. User sees Ondo tile (non-US enterprise only)
2. Clicks "Deposit"
3. If no Ondo KYC record for selected wallet:
   - Modal: "Ondo requires separate identity verification. Complete KYC at ondo.finance, then return here to confirm."
   - Link to ondo.finance opens in new tab
   - "I've completed Ondo KYC" button
4. On "I've completed" click → calls verify endpoint
   - If verified: modal closes, green "Ondo KYC Verified" badge appears on tile, deposit form opens
   - If not verified: "Your wallet isn't whitelisted yet. Ondo may still be processing your verification. Try again later."
5. On subsequent visits: Ondo tile shows green "KYC Verified" badge if wallet is verified, deposit flows normally

---

## 8. Lite Tier Gate

### Problem

Lite tier users should not be able to execute any real actions (link accounts, deposit, withdraw, transact). They can browse and view test data only.

### API-Level Enforcement

New helper: `src/lib/auth/tier-gate.ts`

```typescript
export function requirePaidTier(session: Session): void {
  if (session.user.subscription_tier === 'lite') {
    throw new TierGateError('This action requires a paid plan');
  }
}
```

Applied to all POST endpoints for:
- Bank account linking (Plaid exchange, TrueLayer callback, manual add)
- Wallet linking
- Ramp execute
- Swap execute
- Bridge execute
- Transfer execute
- Fiat payment create
- ERP connection
- Yield deposit
- Yield withdraw

Returns HTTP 403 with `{ error: 'upgrade_required', message: '...' }`.

### UI-Level Gate

New component: `src/components/ui/upgrade-gate.tsx`

```typescript
interface UpgradeGateProps {
  children: React.ReactNode;  // The button/action to wrap
  label?: string;             // Override button label for Lite users
}
```

Behavior:
- For paid tiers: renders children normally
- For Lite tier: renders the button with a lock icon and optional "Pro" badge, disables default action, opens upgrade modal on click

### Upgrade Modal

Reuses existing upgrade flow (`src/components/billing/UpgradeFlow.tsx`). Modal shows:
- "Upgrade to unlock" heading
- Feature the user tried to use (e.g., "Link Bank Account")
- Tier comparison (brief)
- CTA button to billing/upgrade page

### Visual Treatment

- Lock icon (Lucide `Lock`) overlaid on or next to the button text
- Small "Pro" badge (teal pill) next to the button
- Button style: muted/secondary variant instead of primary, to visually indicate it's not actionable
- Tooltip on hover: "Upgrade to a paid plan to [action]"

---

## 9. Environment Mode Cleanup

### Problem

Current env setup uses inconsistent `*_USE_MOCK` flags per integration. Need a clean model for: dev sandbox, production mock (Lite), production sandbox (Paid+test), production live (Paid+live).

### Three Runtime Modes

```typescript
type IntegrationMode = 'mock' | 'sandbox' | 'live';
```

Determined per-request:

```
Lite tier (any server)           → 'mock'    (dummy data, no API calls)
Paid tier + test mode toggle on  → 'sandbox' (sandbox API calls)
Paid tier + test mode toggle off → 'live'    (live API calls)
```

On dev server: even if mode resolves to `'live'`, the env vars only contain sandbox keys — safety net against accidental live calls during development.

### Helper

`src/lib/env/integration-mode.ts`:

```typescript
export function getIntegrationMode(session: Session): IntegrationMode {
  if (session.user.subscription_tier === 'lite') return 'mock';
  if (session.user.test_mode) return 'sandbox';
  return 'live';
}
```

### Credential Pattern

Each integration stores both sandbox and live keys:

```
# Stripe (existing keys — used for billing AND Financial Connections)
# STRIPE_SECRET_KEY= (already configured)
# STRIPE_PUBLISHABLE_KEY= (already configured)

# Bridge
BRIDGE_API_KEY_SANDBOX=
BRIDGE_API_KEY_LIVE=

# Persona
PERSONA_API_KEY_SANDBOX=
PERSONA_API_KEY_LIVE=

# Chainalysis
CHAINALYSIS_SANCTIONS_API_KEY_SANDBOX=
CHAINALYSIS_SANCTIONS_API_KEY_LIVE=
# ... etc
```

Credential selector helper:

```typescript
export function getCredentials<T>(mode: IntegrationMode, sandbox: T, live: T): T {
  if (mode === 'mock') return sandbox; // doesn't matter, won't be used
  return mode === 'sandbox' ? sandbox : live;
}
```

### Adapter Factory Changes

All adapter factories (`banking/factory.ts`, `yield/factory.ts`, etc.) accept `IntegrationMode`:

```typescript
export function getBankingAdapter(mode: IntegrationMode): IBankingAdapter {
  if (mode === 'mock') return new BridgeMockAdapter();
  // Both sandbox and live use the real adapter, just different keys
  return new BridgeAdapter(getCredentials(mode, sandboxKeys, liveKeys));
}
```

### Migration from Current Setup

- Remove all `*_USE_MOCK` env vars from `.env.local`, `.env.development`, `.env.local.example`, Vercel
- Replace with `_SANDBOX` / `_LIVE` key pairs
- Add `FORCE_MOCK=true` as a single escape hatch for offline dev / CI
- Update `.env.local.example` with new pattern
- On dev: only sandbox keys populated (live keys empty or absent)
- On Vercel: both sandbox and live keys populated

### Yield Rate Cron Consideration

The yield rate cron job runs server-wide, not per-customer. It should always fetch **live** rates (these are public on-chain/API reads, not customer-specific). The mock/sandbox/live distinction doesn't apply to rate fetching — rates are the same regardless of customer mode. The mode distinction only applies when a customer **executes** a deposit/withdrawal.

---

## Non-Goals

- TrueLayer Payment Initiation (PIS) — deferred, Bridge handles all money movement
- Cookie consent banner — deferred
- BUIDL (BlackRock) integration — deferred, too institutional
- Pendle integration — deferred to follow-up (can be added later using same rate fetcher pattern)
- Multisig wallet support (Safe/Squads) — separate initiative
- Real Bridge.xyz adapter implementation — this spec uses the existing mock; live Bridge adapter is a separate task

---

## Dependencies & Prerequisites

| Item | Status | Needed for |
|---|---|---|
| Stripe account (existing) | Already configured | Section 2 |
| Persona KYB template with country field | **User to configure** | Section 1 |
| Ethereum RPC (Infura) | Already configured | Sections 3, 5 |
| Solana RPC (Helius) | Already configured | Section 3 |
| Vercel Cron (Pro plan) | Already on Pro | Section 3 |

---

## File Impact Summary

### New Files
- `src/lib/banking/stripe-fc.ts`
- `src/lib/banking/belvo.ts`
- `src/app/api/bank-accounts/stripe-fc/session/route.ts`
- `src/app/api/bank-accounts/stripe-fc/link/route.ts`
- `src/app/api/bank-accounts/belvo/widget-token/route.ts`
- `src/app/api/bank-accounts/belvo/link/route.ts`
- `src/lib/yield/rates/client.ts` (shared viem client)
- `src/lib/yield/rates/aave.ts`
- `src/lib/yield/rates/compound.ts`
- `src/lib/yield/rates/morpho.ts`
- `src/lib/yield/rates/sky.ts`
- `src/lib/yield/rates/ondo.ts`
- `src/lib/yield/rates/ethena.ts`
- `src/lib/yield/rates/maple.ts`
- `src/lib/yield/rates/kamino.ts`
- `src/lib/yield/rates/drift.ts`
- `src/app/api/cron/yield-rates/route.ts`
- `src/app/api/yield/ondo/verify-kyc/route.ts`
- `src/app/api/yield/ondo/kyc-status/route.ts`
- `src/lib/auth/tier-gate.ts`
- `src/components/ui/upgrade-gate.tsx`
- `src/lib/env/integration-mode.ts`

### Modified Files
- `src/types/database.ts` — Enterprise type (add country), BankAccount type (add stripe_fc + belvo fields), new Ondo KYC type
- `src/lib/fx/rates.ts` — Add BRL, MXN to supported currencies, mock FX rates, symbols
- `src/components/banking/RampForm.tsx` — Add BRL, MXN to currency enum
- `src/components/banking/ScheduleRampForm.tsx` — Add BRL, MXN to currency enum
- `src/components/payments/SendPaymentForm.tsx` — Add BRL, MXN to currency enum
- `src/components/payments/SchedulePaymentForm.tsx` — Add BRL, MXN to currency enum
- `src/components/invoices/InvoiceTable.tsx` — Add BRL, MXN to CURRENCIES array
- `src/lib/test-mode/seed/banking.ts` — Add BR/MX bank accounts and BRL/MXN transactions
- `src/lib/test-mode/seed/transactions.ts` — Add BRL/MXN to currency pool for fiat payments
- `src/lib/test-mode/seed/erp.ts` — Add BRL/MXN vendors and invoices
- `src/lib/yield/interface.ts` — add `compound_v3` to YieldProtocolId
- `src/lib/yield/mock/yield-mock.ts` — add Compound V3 metadata, APY, yield token
- `src/lib/yield/slippage/liquidity-provider.ts` — add Compound pool data
- `src/lib/yield/factory.ts` — add Compound, accept IntegrationMode
- `src/lib/banking/factory.ts` — accept IntegrationMode, route mock/sandbox/live
- `src/app/api/yield/rates/route.ts` — read from cache table, filter Ondo by country
- `src/app/api/webhooks/persona/route.ts` — extract country from KYB inquiry
- `src/components/banking/PlaidLinkButton.tsx` → rename to `BankLinkButton.tsx`, replace Plaid with Stripe FC + Belvo routing
- `src/components/banking/BankAccountsTab.tsx` — balance refresh routing by provider

### Deleted Files (Plaid removal)
- `src/lib/banking/plaid.ts`
- `src/app/api/bank-accounts/plaid/link-token/route.ts`
- `src/app/api/bank-accounts/plaid/exchange/route.ts`
- `src/components/yield/YieldRatesTable.tsx` — stale indicators, timestamp, Ondo KYC flow, upgrade gate on deposit
- `src/components/yield/YieldPositionList.tsx` — upgrade gate on withdraw
- `.env.local.example` — new credential pattern
- `vercel.json` — add yield-rates cron

### New Database Migration
- Add `country` to `enterprises`
- Add `banking_provider`, `stripe_fc_account_id`, `belvo_*`, `iban` to `bank_accounts`
- Create `yield_rate_cache` table
- Create `ondo_kyc_verifications` table

### npm Dependencies
- `@belvo/connect-widget` — Belvo bank linking widget for React
