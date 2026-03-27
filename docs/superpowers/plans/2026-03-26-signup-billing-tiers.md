# Signup, Billing & Account Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete signup, subscription billing, and account tier system for Vantor with Stripe billing, Persona KYC/KYB, transaction fees, and billing management UI.

**Architecture:** Hybrid model — Stripe manages subscriptions/payments, the app owns feature gating. A `subscription_tier` enum on the enterprise table (synced from `subscriptions.tier` via Stripe webhooks) drives all gating decisions. Persona handles KYC/KYB with hosted inquiry flows. Transaction fees (0.1% Vantor fee) are recorded in `usage_fees` and injected into Stripe invoices before finalization.

**Tech Stack:** Next.js 14 App Router, Supabase (Postgres), NextAuth v4 (JWT), Stripe (subscriptions/billing), Persona (KYC/KYB), Resend (emails), @react-pdf/renderer (invoices), Zustand, TanStack Query, Zod, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-25-signup-billing-tiers-design.md`

**Important Codebase Conventions:**
- **Supabase admin client:** Always use `import { createAdminClient } from '@/lib/supabase/admin'` and call `createAdminClient()` inside each handler function (NOT at module scope). Never use raw `createClient` from `@supabase/supabase-js` directly.
- **Stripe API version:** Omit the `apiVersion` parameter in the Stripe constructor to use the SDK's default. Do NOT specify a custom version string.
- **Persona SDK:** Use REST API directly (no NPM package). Client-side SDK loaded via `<script>` tag.
- **RBAC prefix matching:** `rbac.ts` uses `pathname.startsWith(route)` — more specific routes must be checked before less specific ones. Check existing patterns before adding new entries.
- **Shared utilities:** Extract duplicated helpers (e.g., `getNextFirstOfMonth()`) to `src/lib/billing/utils.ts`.

---

## File Structure

### New Files to Create

```
# Database
supabase/migrations/0015_billing_schema.sql          — New tables, enums, enterprise modifications

# Tier config & feature gating
src/lib/billing/tiers.ts                              — Tier definitions, prices, caps, feature flags
src/lib/billing/gate.ts                               — Feature gating functions (canAccessLiveMode, isAtAssetCap, etc.)
src/lib/billing/stripe.ts                             — Stripe client singleton + helper functions
src/lib/billing/usage.ts                              — Usage fee recording and aggregation
src/lib/billing/invoice-pdf.ts                        — PDF invoice generation via @react-pdf/renderer
src/lib/billing/utils.ts                              — Shared billing utilities (getNextFirstOfMonth, etc.)

# Webhook handlers
src/app/api/webhooks/stripe/route.ts                  — Stripe webhook (signature verify, idempotent, event dispatch)
src/app/api/webhooks/persona/route.ts                 — Persona webhook (signature verify, KYC/KYB status updates)

# Billing API routes
src/app/api/billing/subscription/route.ts             — GET/POST/PATCH subscription (read, upgrade, downgrade)
src/app/api/billing/usage/route.ts                    — GET current period usage fees
src/app/api/billing/invoices/route.ts                 — GET past invoices from Stripe
src/app/api/billing/invoices/[id]/pdf/route.ts        — GET download invoice PDF
src/app/api/billing/payment-method/route.ts           — GET/POST payment method (read, setup intent)
src/app/api/billing/checkout/route.ts                 — POST create Stripe checkout session
src/app/api/billing/asset-cap/route.ts                — GET current asset total vs cap

# KYC/KYB API routes
src/app/api/kyc/start/route.ts                        — POST start Persona KYC inquiry
src/app/api/kyc/status/route.ts                       — GET KYC status for current user
src/app/api/kyb/start/route.ts                        — POST start Persona KYB inquiry
src/app/api/kyb/status/route.ts                       — GET KYB status for enterprise

# Admin routes
src/app/api/admin/invitations/route.ts                — POST/GET invitations (send, list)
src/app/api/admin/enterprise/[id]/plan/route.ts       — PATCH set enterprise custom price

# Billing settings UI
src/app/(app)/settings/billing/page.tsx               — Billing settings page (tabs: Plan, Usage, Invoices, Payment)
src/components/billing/PlanTab.tsx                     — Tier display, upgrade/downgrade, asset cap bar
src/components/billing/UsageTab.tsx                    — Current period usage summary
src/components/billing/InvoicesTab.tsx                 — Invoice history table + PDF download
src/components/billing/PaymentMethodTab.tsx            — Card on file display + update
src/components/billing/TierComparisonGrid.tsx          — Side-by-side tier comparison for upgrade flow
src/components/billing/UpgradeFlow.tsx                 — Multi-step: KYB → KYC → Stripe checkout
src/components/billing/AssetCapBanner.tsx              — Persistent banner when at cap
src/components/billing/PastDueBanner.tsx              — Warning banner for past_due subscriptions

# KYC/KYB UI
src/app/(app)/kyc-required/page.tsx                   — Full-screen KYC gate page
src/components/kyc/PersonaKycFlow.tsx                  — Embedded Persona KYC inquiry
src/components/kyc/PersonaKybFlow.tsx                  — Embedded Persona KYB inquiry

# Transaction detail
src/components/transactions/TransactionDetailModal.tsx — Fee breakdown modal for any transaction

# Admin invite UI
src/components/admin/InviteUserForm.tsx                — Email invite form for app admins

# Email templates
src/lib/email/templates/invitation.ts                 — Branded invite email HTML
src/lib/email/templates/monthly-bill.ts               — Monthly bill email HTML wrapper
src/lib/email/send.ts                                 — Resend email helper (wraps existing pattern)
```

### Existing Files to Modify

```
src/app/api/auth/register/route.ts                    — Add enterprise + subscription creation on signup
src/components/auth/RegisterForm.tsx                   — Add company name field, invite token handling
src/lib/auth/nextauth.config.ts                       — Add subscription_tier, kyc_status, kyb_status to JWT
src/lib/auth/rbac.ts                                  — Add billing route permissions
src/lib/test-mode/helpers.ts                          — Replace seed data with $5M spec amounts
src/components/layout/Sidebar.tsx                     — Add Billing settings link, upgrade CTA
src/components/layout/Topbar.tsx                      — Add asset cap banner trigger
src/components/layout/TestModeToggle.tsx               — Disable toggle for Lite tier with tooltip
src/app/api/ramps/quote/route.ts                      — Add vantor_fee to quote response
src/app/api/swaps/quote/route.ts                      — Add vantor_fee to quote response
src/app/api/bridges/quote/route.ts                    — Add vantor_fee to quote response
src/app/api/ramps/execute/route.ts                    — Record usage_fee on execution
src/app/api/swaps/execute/route.ts                    — Record usage_fee on execution
src/app/api/bridges/execute/route.ts                  — Record usage_fee on execution
src/components/banking/RampForm.tsx                    — Display Vantor fee line item in quote
src/components/swaps/SwapForm.tsx                      — Display Vantor fee line item in quote
src/app/(app)/settings/erp/page.tsx                   — Add ERP add-on cost confirmation modal
src/store/appStore.ts                                 — Add subscriptionTier state
src/lib/banking/interface.ts                          — Add vantor_fee to quote interfaces
package.json                                          — Add stripe, @stripe/stripe-js, @stripe/react-stripe-js
```

---

## Task 1: Database Schema Migration

**Files:**
- Create: `supabase/migrations/0015_billing_schema.sql`

This task creates all new tables, enums, and modifications needed for the billing system.

- [ ] **Step 1: Create the migration file**

```sql
-- 0015_billing_schema.sql
-- Billing, subscriptions, KYC/KYB, invitations, usage fees

-- New enum for subscription tiers
CREATE TYPE subscription_tier AS ENUM ('lite', 'starter', 'growth', 'scale', 'enterprise');

-- Add subscription_tier to enterprises (denormalized cache)
ALTER TABLE enterprises ADD COLUMN subscription_tier subscription_tier NOT NULL DEFAULT 'lite';

-- Deprecate existing kyc_status column on enterprises
COMMENT ON COLUMN enterprises.kyc_status IS 'DEPRECATED: Use kyb_verifications table instead';

-- Subscriptions table (source of truth for tier)
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL UNIQUE REFERENCES enterprises(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier subscription_tier NOT NULL DEFAULT 'lite',
  status TEXT NOT NULL DEFAULT 'active',
  custom_price NUMERIC(10,2),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment methods (cached card info for display)
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  stripe_payment_method_id TEXT NOT NULL,
  card_brand TEXT,
  card_last4 TEXT,
  card_exp_month INTEGER,
  card_exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ERP add-ons (paid additional ERPs beyond included 1)
CREATE TABLE erp_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  erp_configuration_id UUID NOT NULL REFERENCES erp_configurations(id) ON DELETE CASCADE,
  stripe_subscription_item_id TEXT,
  monthly_cost NUMERIC(10,2) NOT NULL DEFAULT 1500.00,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage fees (per-transaction Vantor fees for billing)
CREATE TABLE usage_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('ramp', 'swap', 'bridge')),
  transaction_id UUID NOT NULL,
  notional_amount NUMERIC(36,9) NOT NULL,
  fee_rate NUMERIC(10,6) NOT NULL DEFAULT 0.001,
  fee_amount NUMERIC(36,9) NOT NULL,
  billing_period DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook events (idempotency deduplication)
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('stripe', 'persona')),
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invitations (admin invite flow)
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  invited_by UUID NOT NULL REFERENCES user_profiles(id),
  inviter_email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- KYC verifications (per-user identity verification)
CREATE TABLE kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  persona_inquiry_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- KYB verifications (per-enterprise business verification)
CREATE TABLE kyb_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enterprise_id UUID NOT NULL UNIQUE REFERENCES enterprises(id) ON DELETE CASCADE,
  persona_inquiry_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  legal_entity_name TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic tier update function (used by webhook handlers)
CREATE OR REPLACE FUNCTION update_subscription_tier(
  p_sub_id UUID,
  p_enterprise_id UUID,
  p_tier subscription_tier,
  p_status TEXT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
) RETURNS VOID AS $$
BEGIN
  UPDATE subscriptions SET tier=p_tier, status=p_status, current_period_start=p_period_start, current_period_end=p_period_end, updated_at=NOW() WHERE id=p_sub_id;
  UPDATE enterprises SET subscription_tier=p_tier WHERE id=p_enterprise_id;
END;
$$ LANGUAGE plpgsql;

-- Indexes for common queries
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_usage_fees_enterprise_period ON usage_fees(enterprise_id, billing_period);
CREATE INDEX idx_usage_fees_billing_period ON usage_fees(billing_period);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_kyc_verifications_user ON kyc_verifications(user_id);
CREATE INDEX idx_kyb_verifications_enterprise ON kyb_verifications(enterprise_id);
CREATE INDEX idx_payment_methods_enterprise ON payment_methods(enterprise_id);

-- RLS policies
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_verifications ENABLE ROW LEVEL SECURITY;

-- Service role has full access (all API routes use service role client)
-- No user-facing RLS policies needed since all access is through API routes
```

- [ ] **Step 2: Apply the migration**

Run: `cd C:/Users/John/crypto-treasury && npx supabase db push` (if using remote) or `npx supabase migration up` (if local)
Expected: Migration applied successfully, all tables created.

- [ ] **Step 3: Verify tables exist**

Run: Connect to Supabase and run `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('subscriptions', 'payment_methods', 'erp_addons', 'usage_fees', 'webhook_events', 'invitations', 'kyc_verifications', 'kyb_verifications');`
Expected: All 8 tables returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0015_billing_schema.sql
git commit -m "feat: add billing schema migration (subscriptions, KYC/KYB, usage fees, invitations)"
```

---

## Task 2: Install Dependencies & Tier Config

**Files:**
- Modify: `package.json`
- Create: `src/lib/billing/tiers.ts`
- Create: `src/lib/billing/stripe.ts`

- [ ] **Step 1: Install Stripe packages**

Run: `cd C:/Users/John/crypto-treasury && npm install stripe @stripe/stripe-js @stripe/react-stripe-js`
Expected: Packages added to package.json and installed.

- [ ] **Step 2: Create tier definitions**

Create `src/lib/billing/tiers.ts`:

```typescript
export type TierSlug = 'lite' | 'starter' | 'growth' | 'scale' | 'enterprise';

export interface TierDefinition {
  slug: TierSlug;
  name: string;
  price: number | null;         // monthly price in cents, null = custom (enterprise)
  displayPrice: string;         // for UI display
  liveMode: boolean;
  assetCapUsd: number | null;   // null = unlimited
  includedErps: number;         // live mode ERPs included
  kycRequired: boolean;
  kybRequired: boolean;
  creditCardRequired: boolean;
}

export const TIERS: Record<TierSlug, TierDefinition> = {
  lite: {
    slug: 'lite',
    name: 'Lite',
    price: 0,
    displayPrice: 'Free',
    liveMode: false,
    assetCapUsd: null,
    includedErps: 0,
    kycRequired: false,
    kybRequired: false,
    creditCardRequired: false,
  },
  starter: {
    slug: 'starter',
    name: 'Starter',
    price: 95000,               // $950.00
    displayPrice: '$950/mo',
    liveMode: true,
    assetCapUsd: 2_000_000,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
  growth: {
    slug: 'growth',
    name: 'Growth',
    price: 200000,              // $2,000.00
    displayPrice: '$2,000/mo',
    liveMode: true,
    assetCapUsd: 10_000_000,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
  scale: {
    slug: 'scale',
    name: 'Scale',
    price: 500000,              // $5,000.00
    displayPrice: '$5,000/mo',
    liveMode: true,
    assetCapUsd: 20_000_000,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
  enterprise: {
    slug: 'enterprise',
    name: 'Enterprise',
    price: null,
    displayPrice: 'Contact Us',
    liveMode: true,
    assetCapUsd: null,
    includedErps: 1,
    kycRequired: true,
    kybRequired: true,
    creditCardRequired: true,
  },
};

export const TIER_ORDER: TierSlug[] = ['lite', 'starter', 'growth', 'scale', 'enterprise'];

export const ERP_ADDON_PRICE_CENTS = 150000; // $1,500.00/mo

export const VANTOR_FEE_RATE = 0.001; // 0.1%

/** Returns true if `to` is a higher tier than `from` */
export function isUpgrade(from: TierSlug, to: TierSlug): boolean {
  return TIER_ORDER.indexOf(to) > TIER_ORDER.indexOf(from);
}

/** Returns true if `to` is a lower tier than `from` */
export function isDowngrade(from: TierSlug, to: TierSlug): boolean {
  return TIER_ORDER.indexOf(to) < TIER_ORDER.indexOf(from);
}

/** Returns true if the tier is a paid tier */
export function isPaidTier(tier: TierSlug): boolean {
  return tier !== 'lite';
}
```

- [ ] **Step 3: Create Stripe client singleton**

Create `src/lib/billing/stripe.ts`:

```typescript
import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  typescript: true,
});

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/billing/tiers.ts src/lib/billing/stripe.ts
git commit -m "feat: add Stripe deps, tier definitions, and Stripe client"
```

---

## Task 3: Feature Gating Module

**Files:**
- Create: `src/lib/billing/gate.ts`
- Modify: `src/lib/auth/rbac.ts` (add billing route permissions)

- [ ] **Step 1: Create the gating module**

Create `src/lib/billing/gate.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { TierSlug, TIERS, isPaidTier } from './tiers';

/** Can this tier access live mode? */
export function canAccessLiveMode(tier: TierSlug): boolean {
  return TIERS[tier].liveMode;
}

/** Get the asset cap in USD for a tier (null = unlimited) */
export function getAssetCap(tier: TierSlug): number | null {
  return TIERS[tier].assetCapUsd;
}

/** Calculate total connected live assets for an enterprise */
export async function getTotalLiveAssets(enterpriseId: string): Promise<number> {
  const supabase = createClient();

  // Sum wallet balances (USD value)
  const { data: walletBalances } = await supabase
    .from('wallet_balances')
    .select('usd_value, wallets!inner(enterprise_id)')
    .eq('wallets.enterprise_id', enterpriseId);

  const walletTotal = (walletBalances || []).reduce(
    (sum, wb) => sum + (Number(wb.usd_value) || 0),
    0
  );

  // Sum bank account balances (already in USD-equivalent)
  const { data: bankAccounts } = await supabase
    .from('bank_accounts')
    .select('balance')
    .eq('enterprise_id', enterpriseId);

  const bankTotal = (bankAccounts || []).reduce(
    (sum, ba) => sum + (Number(ba.balance) || 0),
    0
  );

  // Sum yield positions
  const { data: yieldPositions } = await supabase
    .from('yield_transactions')
    .select('amount')
    .eq('enterprise_id', enterpriseId)
    .eq('status', 'active');

  const yieldTotal = (yieldPositions || []).reduce(
    (sum, yp) => sum + (Number(yp.amount) || 0),
    0
  );

  return walletTotal + bankTotal + yieldTotal;
}

/** Check if an enterprise is at or above their asset cap */
export async function isAtAssetCap(enterpriseId: string, tier: TierSlug): Promise<boolean> {
  const cap = getAssetCap(tier);
  if (cap === null) return false; // unlimited

  const total = await getTotalLiveAssets(enterpriseId);
  return total >= cap;
}

/** Get the number of live ERP configurations for an enterprise */
export async function getLiveErpCount(enterpriseId: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('erp_configurations')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true);

  return count || 0;
}

/** Get the number of paid ERP add-ons for an enterprise */
export async function getPaidErpAddonCount(enterpriseId: string): Promise<number> {
  const supabase = createClient();
  const { count } = await supabase
    .from('erp_addons')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', enterpriseId)
    .eq('active', true);

  return count || 0;
}

/** Check if an enterprise can add another live ERP */
export async function canAddErp(enterpriseId: string, tier: TierSlug): Promise<boolean> {
  if (!isPaidTier(tier)) return false;

  const currentCount = await getLiveErpCount(enterpriseId);
  const included = TIERS[tier].includedErps;
  const paidAddons = await getPaidErpAddonCount(enterpriseId);

  return currentCount < included + paidAddons;
}

/** Check if downgrade is allowed to a target tier */
export async function canDowngrade(
  enterpriseId: string,
  targetTier: TierSlug
): Promise<{ allowed: boolean; reason?: string }> {
  const targetCap = getAssetCap(targetTier);

  if (targetTier === 'lite') {
    // Downgrade to Lite always allowed — live data preserved but inaccessible
    return { allowed: true };
  }

  if (targetCap !== null) {
    const totalAssets = await getTotalLiveAssets(enterpriseId);
    if (totalAssets > targetCap) {
      return {
        allowed: false,
        reason: `Your connected assets ($${(totalAssets / 1_000_000).toFixed(1)}M) exceed the ${TIERS[targetTier].name} plan cap of $${(targetCap / 1_000_000).toFixed(0)}M.`,
      };
    }
  }

  return { allowed: true };
}
```

- [ ] **Step 2: Add billing routes to RBAC**

Modify `src/lib/auth/rbac.ts` — add to the `ROLE_ROUTES` map:

```typescript
// Add these entries to ROLE_ROUTES (around line 4-17):
'/settings/billing': 'treasury_manager',
'/api/billing': 'treasury_manager',
'/api/kyc': 'auditor',      // any role can check their own KYC
'/api/kyb': 'treasury_manager',
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing/gate.ts src/lib/auth/rbac.ts
git commit -m "feat: add feature gating module and billing RBAC routes"
```

---

## Task 4: Update NextAuth JWT with Billing Fields

**Files:**
- Modify: `src/lib/auth/nextauth.config.ts`

- [ ] **Step 1: Update the JWT callback to include billing fields**

In `src/lib/auth/nextauth.config.ts`, update the JWT callback (around lines 58-97) to fetch and include `subscription_tier`, `kyc_status`, and `kyb_status`:

After the existing profile fetch (around line 70 where it fetches `user_profiles`), add queries for subscription and KYC/KYB status:

```typescript
// Inside the jwt callback, after fetching profile data, add:

// Fetch subscription tier
const { data: subscription } = await supabase
  .from('subscriptions')
  .select('tier')
  .eq('enterprise_id', profile.enterprise_id)
  .single();

// Fetch KYC status for this user
const { data: kyc } = await supabase
  .from('kyc_verifications')
  .select('status')
  .eq('user_id', token.id)
  .single();

// Fetch KYB status for the enterprise
const { data: kyb } = await supabase
  .from('kyb_verifications')
  .select('status')
  .eq('enterprise_id', profile.enterprise_id)
  .single();

token.subscription_tier = subscription?.tier || 'lite';
token.kyc_status = kyc?.status || 'none';
token.kyb_status = kyb?.status || 'none';
```

Also add these fields to:
1. The initial sign-in block (around line 40) where `token` is first populated from `user`
2. The session callback (around line 99) to project them to `session.user`
3. The TypeScript module augmentation (around line 114) to type the new fields

Add to the JWT/Session type augmentation:

```typescript
// In the module augmentation section:
interface JWT {
  // ... existing fields
  subscription_tier: string;
  kyc_status: string;
  kyb_status: string;
}

interface Session {
  user: {
    // ... existing fields
    subscription_tier: string;
    kyc_status: string;
    kyb_status: string;
  }
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `cd C:/Users/John/crypto-treasury && npx next build`
Expected: Build succeeds (may have warnings about missing tables if DB not migrated yet — that's OK).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/nextauth.config.ts
git commit -m "feat: add subscription_tier, kyc_status, kyb_status to NextAuth JWT"
```

---

## Task 5: Update Registration Flow (Enterprise + Subscription Creation)

**Files:**
- Modify: `src/app/api/auth/register/route.ts`
- Modify: `src/components/auth/RegisterForm.tsx`
- Modify: `src/lib/test-mode/helpers.ts`

- [ ] **Step 1: Update seed data to match $5M spec (DO THIS FIRST — registration depends on it)**

Modify `src/lib/test-mode/helpers.ts` — update the `seedTestData()` function (lines 98-392). Change the seed amounts and accounts to match:

- Bank accounts: USD $1,500,000 ("Test Bank of America"), GBP £500,000 ("Test Barclays UK"), EUR €500,000 ("Test Deutsche Bank")
- Wallets: ETH USDC $1,500,000, SOL USDT $500,000
- ERP: "Test SAP S/4HANA" + "Test Oracle NetSuite" (2 integrations)

Export a new `seedTestEnterprise()` function that accepts an optional `supabaseAdmin` client parameter (so registration can call it with the service role client):

```typescript
export async function seedTestEnterprise(
  testEnterpriseId: string,
  adminClient?: ReturnType<typeof createAdminClient>
) {
  const client = adminClient || createAdminClient();
  // ... seed logic with updated amounts from spec
}
```

- [ ] **Step 2: Update the registration API to create enterprise + subscription**

Modify `src/app/api/auth/register/route.ts`. The current flow (48 lines) creates a user and updates `user_profiles.full_name`. Expand it to:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { seedTestEnterprise } from '@/lib/test-mode/helpers';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  fullName: z.string().min(2).max(100),
  companyName: z.string().min(1).max(200),
  inviteToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
    }

    const { email, password, fullName, companyName, inviteToken } = parsed.data;

    const supabaseAdmin = createAdminClient();

    // If invite token provided, validate it
    if (inviteToken) {
      const { data: invitation } = await supabaseAdmin
        .from('invitations')
        .select('*')
        .eq('token', inviteToken)
        .eq('status', 'pending')
        .single();

      if (!invitation || new Date(invitation.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Invalid or expired invitation' }, { status: 400 });
      }

      // Mark invitation as accepted
      await supabaseAdmin
        .from('invitations')
        .update({ status: 'accepted' })
        .eq('id', invitation.id);
    }

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const userId = authData.user.id;

    // Create enterprise
    const { data: enterprise, error: entError } = await supabaseAdmin
      .from('enterprises')
      .insert({
        name: companyName,
        status: 'active',
        subscription_tier: 'lite',
      })
      .select('id')
      .single();

    if (entError) throw entError;

    // Create test enterprise (for test mode)
    const { data: testEnterprise } = await supabaseAdmin
      .from('enterprises')
      .insert({
        name: `${companyName} (Test)`,
        status: 'active',
        subscription_tier: 'lite',
      })
      .select('id')
      .single();

    // Link test enterprise
    if (testEnterprise) {
      await supabaseAdmin
        .from('enterprises')
        .update({ test_enterprise_id: testEnterprise.id })
        .eq('id', enterprise.id);
    }

    // Create subscription record (Lite — no Stripe IDs yet)
    await supabaseAdmin
      .from('subscriptions')
      .insert({
        enterprise_id: enterprise.id,
        tier: 'lite',
        status: 'active',
      });

    // Update user profile with enterprise and role
    await supabaseAdmin
      .from('user_profiles')
      .update({
        full_name: fullName,
        enterprise_id: enterprise.id,
        role: 'treasury_manager',
      })
      .eq('id', userId);

    // Seed test data
    if (testEnterprise) {
      await seedTestEnterprise(testEnterprise.id, supabaseAdmin);
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update RegisterForm to include company name and invite token**

Modify `src/components/auth/RegisterForm.tsx`:

Add `companyName` to the Zod schema:
```typescript
const registerSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  companyName: z.string().min(1, 'Company name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});
```

Read the invite token from URL params via `useSearchParams()`:
```typescript
const searchParams = useSearchParams();
const inviteToken = searchParams.get('invite');
```

If `inviteToken` is present, pre-fill the email from the invitation (fetch via a quick API call or pass as URL param).

Add the company name input field between the full name and email fields in the form JSX.

Include `inviteToken` in the POST body if present.

- [ ] **Step 4: Verify registration works end-to-end**

Run: `cd C:/Users/John/crypto-treasury && npm run dev`
Test: Navigate to `/register`, create a new account with company name, verify:
1. Enterprise created in DB with `subscription_tier = 'lite'`
2. Test enterprise created and linked
3. Subscription record created
4. User profile has `role = 'treasury_manager'` and correct `enterprise_id`
5. Test mode seed data provisioned ($5M)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/register/route.ts src/components/auth/RegisterForm.tsx src/lib/test-mode/helpers.ts
git commit -m "feat: registration creates enterprise, subscription, and seeds $5M test data"
```

---

## Task 6: Stripe Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`

- [ ] **Step 1: Create the Stripe webhook route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { stripe, STRIPE_WEBHOOK_SECRET } from '@/lib/billing/stripe';
import { createClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency check
  const { data: existing } = await supabaseAdmin
    .from('webhook_events')
    .select('id')
    .eq('event_id', event.id)
    .single();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  // Record event
  await supabaseAdmin.from('webhook_events').insert({
    source: 'stripe',
    event_id: event.id,
    event_type: event.type,
  });

  try {
    switch (event.type) {
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.created':
        await handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;
      case 'payment_method.detached':
        await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const supabaseAdmin = createAdminClient();

  // Find our subscription by stripe_subscription_id
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, enterprise_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!sub) return;

  // Determine tier from Stripe product metadata
  const item = subscription.items.data[0];
  const product = await stripe.products.retrieve(item.price.product as string);
  const tier = product.metadata.tier as string || 'lite';

  // Update BOTH tables atomically via Postgres RPC function.
  // Create this function in the migration:
  //   CREATE FUNCTION update_subscription_tier(p_sub_id UUID, p_enterprise_id UUID, p_tier subscription_tier, p_status TEXT, p_period_start TIMESTAMPTZ, p_period_end TIMESTAMPTZ)
  //   RETURNS VOID AS $$ BEGIN
  //     UPDATE subscriptions SET tier=p_tier, status=p_status, current_period_start=p_period_start, current_period_end=p_period_end, updated_at=NOW() WHERE id=p_sub_id;
  //     UPDATE enterprises SET subscription_tier=p_tier WHERE id=p_enterprise_id;
  //   END; $$ LANGUAGE plpgsql;
  await supabaseAdmin.rpc('update_subscription_tier', {
    p_sub_id: sub.id,
    p_enterprise_id: sub.enterprise_id,
    p_tier: tier,
    p_status: subscription.status,
    p_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    p_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const supabaseAdmin = createAdminClient();

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('id, enterprise_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!sub) return;

  // Downgrade to lite atomically
  await supabaseAdmin.rpc('update_subscription_tier', {
    p_sub_id: sub.id,
    p_enterprise_id: sub.enterprise_id,
    p_tier: 'lite',
    p_status: 'canceled',
    p_period_start: null,
    p_period_end: null,
  });
}

async function handleInvoiceCreated(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return;
  const supabaseAdmin = createAdminClient();

  // Find the enterprise
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('enterprise_id')
    .eq('stripe_subscription_id', invoice.subscription)
    .single();

  if (!sub) return;

  // Pause auto-advance so we can add usage fee line items
  await stripe.invoices.update(invoice.id, { auto_advance: false });

  // Aggregate usage fees for this billing period
  const periodStart = new Date(invoice.period_start * 1000);
  const billingPeriod = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: fees } = await supabaseAdmin
    .from('usage_fees')
    .select('transaction_type, fee_amount')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('billing_period', billingPeriod);

  if (fees && fees.length > 0) {
    // Aggregate by type
    const byType: Record<string, { count: number; total: number }> = {};
    for (const fee of fees) {
      if (!byType[fee.transaction_type]) {
        byType[fee.transaction_type] = { count: 0, total: 0 };
      }
      byType[fee.transaction_type].count++;
      byType[fee.transaction_type].total += Number(fee.fee_amount);
    }

    // Add line items for each type
    for (const [type, { count, total }] of Object.entries(byType)) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      await stripe.invoiceItems.create({
        customer: invoice.customer as string,
        invoice: invoice.id,
        amount: Math.round(total * 100), // convert to cents
        currency: 'usd',
        description: `Vantor ${label} fees (${count} transactions)`,
      });
    }
  }

  // Finalize the invoice
  await stripe.invoices.finalizeInvoice(invoice.id);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  // PDF generation and email sending handled in Task 14
  // This is a hook point for that logic
  console.log(`Invoice ${invoice.id} paid for subscription ${invoice.subscription}`);
}

async function handlePaymentMethodAttached(pm: Stripe.PaymentMethod) {
  if (!pm.customer || pm.type !== 'card' || !pm.card) return;
  const supabaseAdmin = createAdminClient();

  // Find enterprise by stripe_customer_id
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('enterprise_id')
    .eq('stripe_customer_id', pm.customer)
    .single();

  if (!sub) return;

  // Set all existing cards to non-default FIRST (avoids race condition)
  await supabaseAdmin
    .from('payment_methods')
    .update({ is_default: false })
    .eq('enterprise_id', sub.enterprise_id);

  // Then insert the new default
  await supabaseAdmin.from('payment_methods').insert({
    enterprise_id: sub.enterprise_id,
    stripe_payment_method_id: pm.id,
    card_brand: pm.card.brand,
    card_last4: pm.card.last4,
    card_exp_month: pm.card.exp_month,
    card_exp_year: pm.card.exp_year,
    is_default: true,
  });
}

async function handlePaymentMethodDetached(pm: Stripe.PaymentMethod) {
  const supabaseAdmin = createAdminClient();
  await supabaseAdmin
    .from('payment_methods')
    .delete()
    .eq('stripe_payment_method_id', pm.id);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/stripe/route.ts
git commit -m "feat: add Stripe webhook handler with signature verification and idempotency"
```

---

## Task 7: Persona Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/persona/route.ts`

- [ ] **Step 1: Create the Persona webhook route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PERSONA_WEBHOOK_SECRET = process.env.PERSONA_WEBHOOK_SECRET!;

function verifyPersonaSignature(body: string, signature: string): boolean {
  // NOTE: Persona's actual signature scheme includes the timestamp in the HMAC payload.
  // Format: "t=<timestamp>,v1=<hash>" where hash = HMAC-SHA256(timestamp + "." + body)
  // Consult Persona's current webhook docs for exact scheme before shipping.
  const parts = signature.split(',');
  const tPart = parts.find(p => p.startsWith('t='));
  const v1Part = parts.find(p => p.startsWith('v1='));
  if (!tPart || !v1Part) return false;

  const timestamp = tPart.substring(2);
  const hash = v1Part.substring(3);

  const hmac = crypto.createHmac('sha256', PERSONA_WEBHOOK_SECRET);
  hmac.update(timestamp + '.' + body);
  const expected = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('persona-signature') || '';

  if (!verifyPersonaSignature(body, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const event = JSON.parse(body);
  const eventId = event.data?.id || event.id;

  // Idempotency check
  const { data: existing } = await supabaseAdmin
    .from('webhook_events')
    .select('id')
    .eq('event_id', eventId)
    .single();

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  await supabaseAdmin.from('webhook_events').insert({
    source: 'persona',
    event_id: eventId,
    event_type: event.data?.attributes?.event_type || 'unknown',
  });

  const eventType = event.data?.attributes?.event_type;
  const inquiry = event.data?.attributes?.payload?.data;

  try {
    if (eventType === 'inquiry.completed' || eventType === 'inquiry.approved') {
      await handleInquiryCompleted(inquiry);
    } else if (eventType === 'inquiry.failed' || eventType === 'inquiry.declined') {
      await handleInquiryFailed(inquiry);
    } else if (eventType === 'inquiry.expired') {
      await handleInquiryExpired(inquiry);
    }
  } catch (err) {
    console.error(`Error handling Persona event ${eventType}:`, err);
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleInquiryCompleted(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;

  // Check if this is a KYC inquiry
  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('id')
    .eq('persona_inquiry_id', inquiryId)
    .single();

  if (kyc) {
    await supabaseAdmin
      .from('kyc_verifications')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', kyc.id);
    return;
  }

  // Check if this is a KYB inquiry
  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('id')
    .eq('persona_inquiry_id', inquiryId)
    .single();

  if (kyb) {
    await supabaseAdmin
      .from('kyb_verifications')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', kyb.id);
  }
}

async function handleInquiryFailed(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;

  await supabaseAdmin
    .from('kyc_verifications')
    .update({ status: 'failed' })
    .eq('persona_inquiry_id', inquiryId);

  await supabaseAdmin
    .from('kyb_verifications')
    .update({ status: 'failed' })
    .eq('persona_inquiry_id', inquiryId);
}

async function handleInquiryExpired(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;

  await supabaseAdmin
    .from('kyc_verifications')
    .update({ status: 'expired' })
    .eq('persona_inquiry_id', inquiryId);

  await supabaseAdmin
    .from('kyb_verifications')
    .update({ status: 'expired' })
    .eq('persona_inquiry_id', inquiryId);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/persona/route.ts
git commit -m "feat: add Persona webhook handler with HMAC verification and idempotency"
```

---

## Task 8: Billing API Routes

**Files:**
- Create: `src/app/api/billing/subscription/route.ts`
- Create: `src/app/api/billing/usage/route.ts`
- Create: `src/app/api/billing/invoices/route.ts`
- Create: `src/app/api/billing/payment-method/route.ts`
- Create: `src/app/api/billing/checkout/route.ts`
- Create: `src/app/api/billing/asset-cap/route.ts`

- [ ] **Step 1: Create subscription route (GET/POST/PATCH)**

Create `src/app/api/billing/subscription/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/billing/stripe';
import { TIERS, TierSlug, isUpgrade, isDowngrade, isPaidTier } from '@/lib/billing/tiers';
import { canDowngrade } from '@/lib/billing/gate';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — current subscription
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  const tier = TIERS[sub.tier as TierSlug];

  return NextResponse.json({
    ...sub,
    tierDetails: tier,
  });
}

// POST — upgrade subscription
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetTier } = await req.json();
  const currentTier = session.user.subscription_tier as TierSlug;

  if (!TIERS[targetTier as TierSlug]) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
  }

  if (targetTier === 'enterprise') {
    return NextResponse.json({ error: 'Contact us for Enterprise pricing' }, { status: 400 });
  }

  if (!isUpgrade(currentTier, targetTier)) {
    return NextResponse.json({ error: 'Can only upgrade to a higher tier via POST' }, { status: 400 });
  }

  // Verify KYB + KYC completed
  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('status')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (kyb?.status !== 'completed') {
    return NextResponse.json({ error: 'KYB verification required before upgrading' }, { status: 400 });
  }

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('status')
    .eq('user_id', session.user.id)
    .single();

  if (kyc?.status !== 'completed') {
    return NextResponse.json({ error: 'KYC verification required before upgrading' }, { status: 400 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  const targetTierDef = TIERS[targetTier as TierSlug];

  if (sub.stripe_subscription_id) {
    // Existing Stripe subscription — upgrade in place
    const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const currentItem = stripeSubscription.items.data[0];

    // Find the price for the target tier
    const prices = await stripe.prices.list({
      product: process.env[`STRIPE_PRODUCT_${targetTier.toUpperCase()}`],
      active: true,
    });

    if (!prices.data[0]) {
      return NextResponse.json({ error: 'Stripe price not found for tier' }, { status: 500 });
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: currentItem.id, price: prices.data[0].id }],
      proration_behavior: 'create_prorations',
    });
  }
  // If no Stripe subscription yet (Lite → paid), it's created via checkout (Task 8 checkout route)

  return NextResponse.json({ success: true });
}

// PATCH — downgrade subscription
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetTier } = await req.json();
  const currentTier = session.user.subscription_tier as TierSlug;

  if (!isDowngrade(currentTier, targetTier)) {
    return NextResponse.json({ error: 'Can only downgrade to a lower tier via PATCH' }, { status: 400 });
  }

  // Check if downgrade is allowed
  const check = await canDowngrade(session.user.enterprise_id, targetTier);
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason }, { status: 400 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (targetTier === 'lite' && sub?.stripe_subscription_id) {
    // Cancel at period end
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  } else if (sub?.stripe_subscription_id) {
    // Downgrade to lower paid tier — schedule change at period end using Stripe subscription schedules
    const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);

    const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
    if (!priceId) {
      return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
    }

    // Create a subscription schedule that transitions at period end
    const schedule = await stripe.subscriptionSchedules.create({
      from_subscription: sub.stripe_subscription_id,
    });

    await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: [{ price: stripeSubscription.items.data[0].price.id as string, quantity: 1 }],
          start_date: stripeSubscription.current_period_start,
          end_date: stripeSubscription.current_period_end,
        },
        {
          items: [{ price: priceId, quantity: 1 }],
          start_date: stripeSubscription.current_period_end,
        },
      ],
    });
  }

  return NextResponse.json({ success: true, effective: 'end_of_period' });
}
```

- [ ] **Step 2: Create usage fees route**

Create `src/app/api/billing/usage/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const now = new Date();
  const billingPeriod = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: fees } = await supabaseAdmin
    .from('usage_fees')
    .select('transaction_type, fee_amount')
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('billing_period', billingPeriod);

  // Aggregate by type
  const summary: Record<string, { count: number; total: number }> = {
    ramp: { count: 0, total: 0 },
    swap: { count: 0, total: 0 },
    bridge: { count: 0, total: 0 },
  };

  for (const fee of fees || []) {
    if (summary[fee.transaction_type]) {
      summary[fee.transaction_type].count++;
      summary[fee.transaction_type].total += Number(fee.fee_amount);
    }
  }

  const totalFees = Object.values(summary).reduce((s, v) => s + v.total, 0);

  // Get ERP add-on count
  const { count: erpAddons } = await supabaseAdmin
    .from('erp_addons')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('active', true);

  return NextResponse.json({
    billingPeriod,
    transactionFees: summary,
    totalTransactionFees: totalFees,
    erpAddons: erpAddons || 0,
    erpAddonCost: (erpAddons || 0) * 1500,
  });
}
```

- [ ] **Step 3: Create invoices route**

Create `src/app/api/billing/invoices/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ invoices: [] });
  }

  const invoices = await stripe.invoices.list({
    customer: sub.stripe_customer_id,
    limit: 24,
  });

  return NextResponse.json({
    invoices: invoices.data.map((inv) => ({
      id: inv.id,
      period_start: inv.period_start,
      period_end: inv.period_end,
      amount_due: inv.amount_due,
      amount_paid: inv.amount_paid,
      status: inv.status,
      created: inv.created,
      invoice_pdf: inv.invoice_pdf,
    })),
  });
}
```

- [ ] **Step 4: Create payment method route**

Create `src/app/api/billing/payment-method/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

// GET — current payment method
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: pm } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .eq('is_default', true)
    .single();

  return NextResponse.json({ paymentMethod: pm || null });
}

// POST — create Stripe SetupIntent for adding/updating card
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No Stripe customer' }, { status: 400 });
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: sub.stripe_customer_id,
    payment_method_types: ['card'],
  });

  return NextResponse.json({ clientSecret: setupIntent.client_secret });
}
```

- [ ] **Step 5: Create checkout route**

Create `src/app/api/billing/checkout/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { TIERS, TierSlug, isPaidTier } from '@/lib/billing/tiers';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { targetTier } = await req.json();

  if (!isPaidTier(targetTier) || targetTier === 'enterprise') {
    return NextResponse.json({ error: 'Invalid tier for checkout' }, { status: 400 });
  }

  // Verify KYB + KYC
  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('status')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (kyb?.status !== 'completed') {
    return NextResponse.json({ error: 'KYB required' }, { status: 400 });
  }

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('status')
    .eq('user_id', session.user.id)
    .single();

  if (kyc?.status !== 'completed') {
    return NextResponse.json({ error: 'KYC required' }, { status: 400 });
  }

  // Get or create Stripe customer
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  let stripeCustomerId = sub?.stripe_customer_id;

  if (!stripeCustomerId) {
    const { data: enterprise } = await supabaseAdmin
      .from('enterprises')
      .select('name')
      .eq('id', session.user.enterprise_id)
      .single();

    const customer = await stripe.customers.create({
      email: session.user.email,
      name: enterprise?.name,
      metadata: { enterprise_id: session.user.enterprise_id },
    });

    stripeCustomerId = customer.id;

    await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_customer_id: stripeCustomerId })
      .eq('enterprise_id', session.user.enterprise_id);
  }

  // Look up the Stripe price for target tier
  const priceId = process.env[`STRIPE_PRICE_${targetTier.toUpperCase()}`];
  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
  }

  // Create Stripe Checkout session
  const checkoutSession = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      billing_cycle_anchor: getNextFirstOfMonth(),
    },
    success_url: `${process.env.NEXTAUTH_URL}/settings/billing?upgrade=success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/settings/billing?upgrade=cancelled`,
    metadata: {
      enterprise_id: session.user.enterprise_id,
      target_tier: targetTier,
    },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

function getNextFirstOfMonth(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.floor(next.getTime() / 1000);
}
```

- [ ] **Step 6: Create asset cap route**

Create `src/app/api/billing/asset-cap/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { getTotalLiveAssets, getAssetCap } from '@/lib/billing/gate';
import { TierSlug } from '@/lib/billing/tiers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tier = session.user.subscription_tier as TierSlug;
  const cap = getAssetCap(tier);
  const total = await getTotalLiveAssets(session.user.enterprise_id);

  return NextResponse.json({
    totalAssets: total,
    assetCap: cap,
    atCap: cap !== null && total >= cap,
    utilizationPercent: cap ? Math.min(100, (total / cap) * 100) : null,
  });
}
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/billing/
git commit -m "feat: add billing API routes (subscription, usage, invoices, payment, checkout, asset cap)"
```

---

## Task 9: KYC/KYB API Routes

**Files:**
- Create: `src/app/api/kyc/start/route.ts`
- Create: `src/app/api/kyc/status/route.ts`
- Create: `src/app/api/kyb/start/route.ts`
- Create: `src/app/api/kyb/status/route.ts`

- [ ] **Step 1: Create KYC start route**

Create `src/app/api/kyc/start/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

const PERSONA_API_KEY = process.env.PERSONA_API_KEY!;
const PERSONA_KYC_TEMPLATE_ID = process.env.PERSONA_KYC_TEMPLATE_ID!;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.enterprise_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if KYC already completed
  const { data: existing } = await supabaseAdmin
    .from('kyc_verifications')
    .select('status, persona_inquiry_id')
    .eq('user_id', session.user.id)
    .single();

  if (existing?.status === 'completed') {
    return NextResponse.json({ status: 'already_completed' });
  }

  // Create Persona inquiry
  const response = await fetch('https://withpersona.com/api/v1/inquiries', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERSONA_API_KEY}`,
      'Content-Type': 'application/json',
      'Persona-Version': '2023-01-05',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          'inquiry-template-id': PERSONA_KYC_TEMPLATE_ID,
          'reference-id': session.user.id,
          'environment-id': process.env.PERSONA_ENVIRONMENT_ID,
        },
      },
    }),
  });

  const result = await response.json();
  const inquiryId = result.data?.id;

  if (!inquiryId) {
    return NextResponse.json({ error: 'Failed to create inquiry' }, { status: 502 });
  }

  // Upsert KYC verification record
  if (existing) {
    await supabaseAdmin
      .from('kyc_verifications')
      .update({ persona_inquiry_id: inquiryId, status: 'pending' })
      .eq('user_id', session.user.id);
  } else {
    await supabaseAdmin.from('kyc_verifications').insert({
      enterprise_id: session.user.enterprise_id,
      user_id: session.user.id,
      persona_inquiry_id: inquiryId,
      status: 'pending',
    });
  }

  return NextResponse.json({
    inquiryId,
    sessionToken: result.data?.attributes?.['session-token'],
  });
}
```

- [ ] **Step 2: Create KYC status route**

Create `src/app/api/kyc/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: kyc } = await supabaseAdmin
    .from('kyc_verifications')
    .select('status, completed_at, created_at')
    .eq('user_id', session.user.id)
    .single();

  return NextResponse.json({
    status: kyc?.status || 'none',
    completedAt: kyc?.completed_at,
  });
}
```

- [ ] **Step 3: Create KYB start route**

Create `src/app/api/kyb/start/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

const PERSONA_API_KEY = process.env.PERSONA_API_KEY!;
const PERSONA_KYB_TEMPLATE_ID = process.env.PERSONA_KYB_TEMPLATE_ID!;

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Check if KYB already completed
  const { data: existing } = await supabaseAdmin
    .from('kyb_verifications')
    .select('status, persona_inquiry_id')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  if (existing?.status === 'completed') {
    return NextResponse.json({ status: 'already_completed' });
  }

  // Create Persona KYB inquiry
  const response = await fetch('https://withpersona.com/api/v1/inquiries', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERSONA_API_KEY}`,
      'Content-Type': 'application/json',
      'Persona-Version': '2023-01-05',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          'inquiry-template-id': PERSONA_KYB_TEMPLATE_ID,
          'reference-id': session.user.enterprise_id,
          'environment-id': process.env.PERSONA_ENVIRONMENT_ID,
        },
      },
    }),
  });

  const result = await response.json();
  const inquiryId = result.data?.id;

  if (!inquiryId) {
    return NextResponse.json({ error: 'Failed to create KYB inquiry' }, { status: 502 });
  }

  // Upsert KYB verification
  if (existing) {
    await supabaseAdmin
      .from('kyb_verifications')
      .update({ persona_inquiry_id: inquiryId, status: 'pending' })
      .eq('enterprise_id', session.user.enterprise_id);
  } else {
    await supabaseAdmin.from('kyb_verifications').insert({
      enterprise_id: session.user.enterprise_id,
      persona_inquiry_id: inquiryId,
      status: 'pending',
    });
  }

  return NextResponse.json({
    inquiryId,
    sessionToken: result.data?.attributes?.['session-token'],
  });
}
```

- [ ] **Step 4: Create KYB status route**

Create `src/app/api/kyb/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.enterprise_id || session.user.role !== 'treasury_manager') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('status, legal_entity_name, completed_at, created_at')
    .eq('enterprise_id', session.user.enterprise_id)
    .single();

  return NextResponse.json({
    status: kyb?.status || 'none',
    legalEntityName: kyb?.legal_entity_name,
    completedAt: kyb?.completed_at,
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/kyc/ src/app/api/kyb/
git commit -m "feat: add KYC/KYB API routes (start inquiry, check status)"
```

---

## Task 10: Transaction Fee Integration

**Files:**
- Create: `src/lib/billing/usage.ts`
- Modify: `src/lib/banking/interface.ts`
- Modify: `src/app/api/ramps/quote/route.ts`
- Modify: `src/app/api/swaps/quote/route.ts`
- Modify: `src/app/api/bridges/quote/route.ts`
- Modify: `src/app/api/ramps/execute/route.ts`
- Modify: `src/app/api/swaps/execute/route.ts`
- Modify: `src/app/api/bridges/execute/route.ts`

- [ ] **Step 1: Create usage fee recording utility**

Create `src/lib/billing/usage.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';
import { VANTOR_FEE_RATE } from './tiers';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export function calculateVantorFee(notionalAmountUsd: number): number {
  return notionalAmountUsd * VANTOR_FEE_RATE;
}

export async function recordUsageFee(params: {
  enterpriseId: string;
  transactionType: 'ramp' | 'swap' | 'bridge';
  transactionId: string;
  notionalAmountUsd: number;
}): Promise<void> {
  const feeAmount = calculateVantorFee(params.notionalAmountUsd);
  const now = new Date();
  const billingPeriod = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  await supabaseAdmin.from('usage_fees').insert({
    enterprise_id: params.enterpriseId,
    transaction_type: params.transactionType,
    transaction_id: params.transactionId,
    notional_amount: params.notionalAmountUsd,
    fee_rate: VANTOR_FEE_RATE,
    fee_amount: feeAmount,
    billing_period: billingPeriod,
  });
}
```

- [ ] **Step 2: Add vantor_fee to banking adapter interfaces**

Modify `src/lib/banking/interface.ts` — add `vantor_fee?: number` to `RampQuote`, `SwapQuote`, and `BridgeQuote` interfaces. This field is optional since the adapter doesn't calculate it — the API route adds it.

- [ ] **Step 3: Add vantor_fee to quote API responses**

For each quote route, after getting the adapter quote, calculate and append the Vantor fee (only if in live mode):

In `src/app/api/ramps/quote/route.ts`, after `const quote = await adapter.getRampQuote(...)`:
```typescript
import { isTestMode } from '@/lib/test-mode/helpers';
import { calculateVantorFee } from '@/lib/billing/usage';

// After getting quote:
const testMode = isTestMode();
const vantorFee = testMode ? 0 : calculateVantorFee(quote.fiatAmount);

return NextResponse.json({ ...quote, vantor_fee: vantorFee });
```

Apply the same pattern to `src/app/api/swaps/quote/route.ts` (fee on `fromAmount` USD value) and `src/app/api/bridges/quote/route.ts` (fee on `fromAmount` USD value).

- [ ] **Step 4: Record usage fee on execute routes**

For each execute route, after successful execution, record the usage fee (only in live mode):

In `src/app/api/ramps/execute/route.ts`, after successful insert of `fiat_transactions`:
```typescript
import { isTestMode } from '@/lib/test-mode/helpers';
import { recordUsageFee } from '@/lib/billing/usage';

// After successful execution:
if (!isTestMode()) {
  await recordUsageFee({
    enterpriseId: effectiveEnterpriseId,
    transactionType: 'ramp',
    transactionId: fiatTransaction.id,
    notionalAmountUsd: body.fiatAmount,
  });
}
```

Apply the same pattern to swap execute (transactionType: 'swap') and bridge execute (transactionType: 'bridge').

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/usage.ts src/lib/banking/interface.ts src/app/api/ramps/ src/app/api/swaps/ src/app/api/bridges/
git commit -m "feat: add 0.1% Vantor fee to ramp/swap/bridge quote and execute flows"
```

---

## Task 11: Transaction Fee Display in UI

**Files:**
- Modify: `src/components/banking/RampForm.tsx`
- Modify: `src/components/swaps/SwapForm.tsx`
- Create: `src/components/transactions/TransactionDetailModal.tsx`

- [ ] **Step 1: Add Vantor fee line item to RampForm quote display**

In `src/components/banking/RampForm.tsx`, in the quote display section (around lines 343-389), add a new row after the existing "Fee" row:

```tsx
{/* Existing fee row */}
<div className="flex justify-between text-sm">
  <span className="text-muted-foreground">Partner fee</span>
  <span>{formatCurrency(quote.feeAmount, quote.fiatCurrency)}</span>
</div>
{/* New Vantor fee row */}
{quote.vantor_fee > 0 && (
  <div className="flex justify-between text-sm">
    <span className="text-muted-foreground">Vantor fee (0.1%)</span>
    <span>{formatCurrency(quote.vantor_fee, quote.fiatCurrency)}</span>
  </div>
)}
{/* Total row */}
{quote.vantor_fee > 0 && (
  <div className="flex justify-between text-sm font-medium border-t border-border/50 pt-1 mt-1">
    <span>Total fees</span>
    <span>{formatCurrency(quote.feeAmount + quote.vantor_fee, quote.fiatCurrency)}</span>
  </div>
)}
```

- [ ] **Step 2: Add Vantor fee line item to SwapForm quote display**

Same pattern in `src/components/swaps/SwapForm.tsx` (around lines 241-289). Add after the rate/price impact rows:

```tsx
{quote.vantor_fee > 0 && (
  <div className="flex justify-between text-sm">
    <span className="text-muted-foreground">Vantor fee (0.1%)</span>
    <span className="text-muted-foreground">${Number(quote.vantor_fee).toFixed(2)}</span>
  </div>
)}
```

- [ ] **Step 3: Create TransactionDetailModal**

Create `src/components/transactions/TransactionDetailModal.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';

interface TransactionDetail {
  id: string;
  type: 'ramp' | 'swap' | 'bridge' | 'payment' | 'onchain';
  status: string;
  timestamp: string;
  from: string;
  to: string;
  amount: number;
  token: string;
  partnerFee?: number;
  vantorFee?: number;
  totalCost?: number;
  netReceived?: number;
  txHash?: string;
  chain?: string;
  metadata?: Record<string, unknown>;
}

interface TransactionDetailModalProps {
  transaction: TransactionDetail | null;
  onClose: () => void;
}

export function TransactionDetailModal({ transaction, onClose }: TransactionDetailModalProps) {
  if (!transaction) return null;

  const totalFees = (transaction.partnerFee || 0) + (transaction.vantorFee || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Transaction Details</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3">
          <Row label="Type" value={transaction.type.charAt(0).toUpperCase() + transaction.type.slice(1)} />
          <Row label="Status" value={transaction.status} />
          <Row label="Date" value={new Date(transaction.timestamp).toLocaleString()} />
          <Row label="From" value={transaction.from} />
          <Row label="To" value={transaction.to} />

          <div className="border-t border-border my-3" />

          <Row label="Amount" value={`${transaction.amount.toLocaleString()} ${transaction.token}`} />
          {transaction.partnerFee !== undefined && transaction.partnerFee > 0 && (
            <Row label="Partner fee" value={`$${transaction.partnerFee.toFixed(2)}`} />
          )}
          {transaction.vantorFee !== undefined && transaction.vantorFee > 0 && (
            <Row label="Vantor fee (0.1%)" value={`$${transaction.vantorFee.toFixed(2)}`} />
          )}
          {totalFees > 0 && (
            <Row label="Total fees" value={`$${totalFees.toFixed(2)}`} bold />
          )}
          {transaction.netReceived !== undefined && (
            <Row label="Net received" value={`${transaction.netReceived.toLocaleString()} ${transaction.token}`} bold />
          )}

          {transaction.txHash && (
            <>
              <div className="border-t border-border my-3" />
              <Row label="Chain" value={transaction.chain || ''} />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tx Hash</span>
                <span className="font-mono text-xs truncate max-w-[200px]">{transaction.txHash}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? 'font-medium' : ''}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/banking/RampForm.tsx src/components/swaps/SwapForm.tsx src/components/transactions/TransactionDetailModal.tsx
git commit -m "feat: add Vantor fee display in quote UIs and transaction detail modal"
```

---

## Task 12: Billing Settings UI

**Files:**
- Create: `src/app/(app)/settings/billing/page.tsx`
- Create: `src/components/billing/PlanTab.tsx`
- Create: `src/components/billing/UsageTab.tsx`
- Create: `src/components/billing/InvoicesTab.tsx`
- Create: `src/components/billing/PaymentMethodTab.tsx`
- Create: `src/components/billing/TierComparisonGrid.tsx`
- Create: `src/components/billing/AssetCapBanner.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the billing settings page**

Create `src/app/(app)/settings/billing/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { TabNav } from '@/components/ui/tab-nav';
import { PlanTab } from '@/components/billing/PlanTab';
import { UsageTab } from '@/components/billing/UsageTab';
import { InvoicesTab } from '@/components/billing/InvoicesTab';
import { PaymentMethodTab } from '@/components/billing/PaymentMethodTab';

type BillingTab = 'plan' | 'usage' | 'invoices' | 'payment';

const TABS = [
  { value: 'plan' as const, label: 'Plan' },
  { value: 'usage' as const, label: 'Usage' },
  { value: 'invoices' as const, label: 'Invoices' },
  { value: 'payment' as const, label: 'Payment Method' },
];

export default function BillingSettingsPage() {
  const [activeTab, setActiveTab] = useState<BillingTab>('plan');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">
          Manage your subscription, view usage, and update payment details.
        </p>
      </div>

      <TabNav tabs={TABS} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'plan' && <PlanTab />}
      {activeTab === 'usage' && <UsageTab />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'payment' && <PaymentMethodTab />}
    </div>
  );
}
```

- [ ] **Step 2: Create TierComparisonGrid**

Create `src/components/billing/TierComparisonGrid.tsx`:

```tsx
'use client';

import { TIERS, TIER_ORDER, TierSlug } from '@/lib/billing/tiers';
import { Check, X } from 'lucide-react';

interface TierComparisonGridProps {
  currentTier: TierSlug;
  onSelectTier: (tier: TierSlug) => void;
}

export function TierComparisonGrid({ currentTier, onSelectTier }: TierComparisonGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {TIER_ORDER.map((slug) => {
        const tier = TIERS[slug];
        const isCurrent = slug === currentTier;

        return (
          <div
            key={slug}
            className={`rounded-xl border p-5 flex flex-col ${
              isCurrent
                ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                : 'border-border hover:border-primary/40 transition-colors'
            }`}
          >
            <h3 className="font-semibold text-lg">{tier.name}</h3>
            <p className="text-2xl font-bold mt-2">{tier.displayPrice}</p>

            <ul className="mt-4 space-y-2 flex-1 text-sm">
              <FeatureRow enabled={true} label="Test mode" />
              <FeatureRow enabled={tier.liveMode} label="Live mode" />
              <FeatureRow
                enabled={true}
                label={tier.assetCapUsd ? `$${(tier.assetCapUsd / 1_000_000).toFixed(0)}M asset cap` : 'Unlimited assets'}
              />
              <FeatureRow enabled={tier.liveMode} label={`${tier.includedErps} live ERP${tier.includedErps !== 1 ? 's' : ''} included`} />
            </ul>

            <div className="mt-4">
              {isCurrent ? (
                <div className="text-center text-sm font-medium text-primary py-2">
                  Current Plan
                </div>
              ) : slug === 'enterprise' ? (
                <a
                  href="mailto:sales@vantor.xyz?subject=Enterprise%20Plan%20Inquiry"
                  className="block text-center py-2 px-4 rounded-lg border border-primary text-primary hover:bg-primary/5 text-sm font-medium transition-colors"
                >
                  Contact Us
                </a>
              ) : (
                <button
                  onClick={() => onSelectTier(slug)}
                  className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:opacity-90 transition-opacity"
                >
                  {TIER_ORDER.indexOf(slug) > TIER_ORDER.indexOf(currentTier) ? 'Upgrade' : 'Downgrade'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureRow({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {enabled ? (
        <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <X className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
      )}
      <span className={enabled ? '' : 'text-muted-foreground/60'}>{label}</span>
    </li>
  );
}
```

- [ ] **Step 3: Create PlanTab**

Create `src/components/billing/PlanTab.tsx`:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { TierComparisonGrid } from './TierComparisonGrid';
import { TierSlug, TIERS, isUpgrade } from '@/lib/billing/tiers';

export function PlanTab() {
  const { data: session, update: updateSession } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
    enabled: TIERS[tier].liveMode,
  });

  const handleSelectTier = async (targetTier: TierSlug) => {
    if (targetTier === tier) return;

    if (isUpgrade(tier, targetTier)) {
      // Redirect to upgrade flow (KYB → KYC → Checkout)
      window.location.href = `/settings/billing?upgrade=${targetTier}`;
    } else {
      // Downgrade via PATCH
      const res = await fetch('/api/billing/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTier }),
      });

      if (res.ok) {
        await updateSession();
      } else {
        const data = await res.json();
        alert(data.error || 'Downgrade failed');
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Current plan summary */}
      <div className="rounded-xl border border-border p-6 bg-card">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <p className="text-xl font-bold mt-1">{TIERS[tier].name}</p>
            <p className="text-sm text-muted-foreground">{TIERS[tier].displayPrice}</p>
          </div>
          {tier === 'lite' && (
            <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-sm font-medium">
              Upgrade to unlock live mode
            </div>
          )}
        </div>

        {/* Asset cap bar */}
        {assetCap && assetCap.assetCap && (
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">Asset Usage</span>
              <span>
                ${(assetCap.totalAssets / 1_000_000).toFixed(1)}M of $
                {(assetCap.assetCap / 1_000_000).toFixed(0)}M
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  assetCap.atCap ? 'bg-red-500' : 'bg-primary'
                }`}
                style={{ width: `${Math.min(100, assetCap.utilizationPercent)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tier comparison */}
      <TierComparisonGrid currentTier={tier} onSelectTier={handleSelectTier} />
    </div>
  );
}
```

- [ ] **Step 4: Create UsageTab**

Create `src/components/billing/UsageTab.tsx`:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { TIERS, TierSlug } from '@/lib/billing/tiers';

export function UsageTab() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data: usage, isLoading } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => fetch('/api/billing/usage').then(r => r.json()),
  });

  const { data: subscription } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading usage data...</div>;
  }

  const subscriptionCost = TIERS[tier].price ? TIERS[tier].price! / 100 : (subscription?.custom_price || 0);
  const erpAddonCost = usage?.erpAddonCost || 0;
  const totalFees = usage?.totalTransactionFees || 0;
  const totalEstimated = subscriptionCost + erpAddonCost + totalFees;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border p-6 bg-card">
        <h3 className="font-semibold mb-1">Current Billing Period</h3>
        <p className="text-sm text-muted-foreground">{usage?.billingPeriod || 'N/A'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryCard label="Subscription" value={`$${subscriptionCost.toLocaleString()}`} />
        <SummaryCard label="ERP Add-ons" value={`$${erpAddonCost.toLocaleString()}`} detail={`${usage?.erpAddons || 0} additional ERPs`} />
        <SummaryCard
          label="Ramp Fees"
          value={`$${(usage?.transactionFees?.ramp?.total || 0).toFixed(2)}`}
          detail={`${usage?.transactionFees?.ramp?.count || 0} transactions`}
        />
        <SummaryCard
          label="Swap Fees"
          value={`$${(usage?.transactionFees?.swap?.total || 0).toFixed(2)}`}
          detail={`${usage?.transactionFees?.swap?.count || 0} transactions`}
        />
        <SummaryCard
          label="Bridge Fees"
          value={`$${(usage?.transactionFees?.bridge?.total || 0).toFixed(2)}`}
          detail={`${usage?.transactionFees?.bridge?.count || 0} transactions`}
        />
      </div>

      <div className="rounded-xl border-2 border-primary/30 p-6 bg-primary/5">
        <div className="flex justify-between items-center">
          <span className="font-semibold">Estimated Total</span>
          <span className="text-2xl font-bold">${totalEstimated.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-border p-4 bg-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold mt-1">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-1">{detail}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Create InvoicesTab**

Create `src/components/billing/InvoicesTab.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';

export function InvoicesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () => fetch('/api/billing/invoices').then(r => r.json()),
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading invoices...</div>;
  }

  const invoices = data?.invoices || [];

  // CSV export handler using existing src/lib/export/csv.ts utility
  const handleCsvExport = () => {
    if (!invoices.length) return;
    const rows = invoices.map((inv: any) => ({
      period: `${new Date(inv.period_start * 1000).toLocaleDateString()} - ${new Date(inv.period_end * 1000).toLocaleDateString()}`,
      amount: (inv.amount_paid / 100).toFixed(2),
      status: inv.status,
      date: new Date(inv.created * 1000).toLocaleDateString(),
    }));
    // Use existing CSV export utility from src/lib/export/csv.ts
    const { exportToCsv } = require('@/lib/export/csv');
    exportToCsv(rows, 'vantor-invoices');
  };

  if (invoices.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No invoices yet. Invoices will appear here after your first billing cycle.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleCsvExport}
          className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
        >
          Export CSV
        </button>
      </div>
    <div className="rounded-xl border border-border overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground">Period</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground">Amount</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground">Status</th>
            <th className="text-left p-3 text-sm font-medium text-muted-foreground">Date</th>
            <th className="text-right p-3 text-sm font-medium text-muted-foreground">PDF</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv: any) => (
            <tr key={inv.id} className="border-t border-border">
              <td className="p-3 text-sm">
                {new Date(inv.period_start * 1000).toLocaleDateString()} —{' '}
                {new Date(inv.period_end * 1000).toLocaleDateString()}
              </td>
              <td className="p-3 text-sm font-medium">
                ${(inv.amount_paid / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td className="p-3 text-sm">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  inv.status === 'paid' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                }`}>
                  {inv.status}
                </span>
              </td>
              <td className="p-3 text-sm text-muted-foreground">
                {new Date(inv.created * 1000).toLocaleDateString()}
              </td>
              <td className="p-3 text-right">
                {inv.invoice_pdf && (
                  <a
                    href={inv.invoice_pdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:text-primary/80 text-sm"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Create PaymentMethodTab**

Create `src/components/billing/PaymentMethodTab.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { CreditCard } from 'lucide-react';
import { TierSlug, isPaidTier } from '@/lib/billing/tiers';

export function PaymentMethodTab() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data } = useQuery({
    queryKey: ['payment-method'],
    queryFn: () => fetch('/api/billing/payment-method').then(r => r.json()),
    enabled: isPaidTier(tier),
  });

  if (!isPaidTier(tier)) {
    return (
      <div className="text-center py-12">
        <CreditCard className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-muted-foreground">
          Add a payment method when you upgrade to a paid plan.
        </p>
      </div>
    );
  }

  const pm = data?.paymentMethod;

  const handleUpdateCard = async () => {
    const res = await fetch('/api/billing/payment-method', { method: 'POST' });
    const { clientSecret } = await res.json();
    // Open Stripe Elements or redirect to Stripe-hosted page
    // This will be wired up with @stripe/react-stripe-js
    console.log('Setup intent created:', clientSecret);
  };

  return (
    <div className="rounded-xl border border-border p-6 bg-card">
      {pm ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="w-8 h-8 text-muted-foreground" />
            <div>
              <p className="font-medium capitalize">{pm.card_brand} •••• {pm.card_last4}</p>
              <p className="text-sm text-muted-foreground">
                Expires {pm.card_exp_month}/{pm.card_exp_year}
              </p>
            </div>
          </div>
          <button
            onClick={handleUpdateCard}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Update Card
          </button>
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-muted-foreground mb-3">No payment method on file.</p>
          <button
            onClick={handleUpdateCard}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
          >
            Add Payment Method
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Create AssetCapBanner**

Create `src/components/billing/AssetCapBanner.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { AlertTriangle } from 'lucide-react';
import { TierSlug, TIERS } from '@/lib/billing/tiers';
import Link from 'next/link';

export function AssetCapBanner() {
  const { data: session } = useSession();
  const tier = (session?.user?.subscription_tier || 'lite') as TierSlug;

  const { data: assetCap } = useQuery({
    queryKey: ['asset-cap'],
    queryFn: () => fetch('/api/billing/asset-cap').then(r => r.json()),
    enabled: TIERS[tier].liveMode && TIERS[tier].assetCapUsd !== null,
    refetchInterval: 60000, // check every minute
  });

  if (!assetCap?.atCap) return null;

  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
        <span className="text-sm font-medium text-red-500">
          You&apos;ve reached your asset cap. Upgrade to continue.
        </span>
      </div>
      <Link
        href="/settings/billing"
        className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
      >
        Upgrade
      </Link>
    </div>
  );
}
```

- [ ] **Step 8: Add Billing link to Sidebar**

Modify `src/components/layout/Sidebar.tsx` — add a "Billing" entry under Settings (around lines 90-96), between "Account Management" and "External Integrations":

```typescript
{
  label: 'Billing',
  href: '/settings/billing',
  icon: CreditCard,  // import from lucide-react
  minRole: 'treasury_manager' as const,
},
```

Also add an upgrade CTA for Lite users at the bottom of the sidebar (before the toggle button, around line 228):

```tsx
{session?.user?.subscription_tier === 'lite' && (
  <Link
    href="/settings/billing"
    className="mx-3 mb-3 px-4 py-2.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium text-center shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:opacity-90 transition-opacity"
  >
    Upgrade to unlock live mode
  </Link>
)}
```

- [ ] **Step 9: Create PastDueBanner for subscription warnings**

Create `src/components/billing/PastDueBanner.tsx` — similar to AssetCapBanner but for `past_due` subscription status:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

export function PastDueBanner() {
  const { data: session } = useSession();
  const { data: sub } = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: () => fetch('/api/billing/subscription').then(r => r.json()),
    enabled: !!session?.user?.enterprise_id,
  });

  if (sub?.status !== 'past_due') return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
        <span className="text-sm font-medium text-amber-500">
          Payment failed. Update your payment method to avoid service interruption.
        </span>
      </div>
      <Link
        href="/settings/billing?tab=payment"
        className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
      >
        Update Payment
      </Link>
    </div>
  );
}
```

- [ ] **Step 10: Add AssetCapBanner and PastDueBanner to Topbar**

Modify `src/components/layout/Topbar.tsx` — import and render both `AssetCapBanner` and `PastDueBanner` at the top of the topbar component, before the main content.

- [ ] **Step 10: Commit**

```bash
git add src/app/(app)/settings/billing/ src/components/billing/ src/components/layout/Sidebar.tsx src/components/layout/Topbar.tsx
git commit -m "feat: add billing settings UI (plan, usage, invoices, payment) and asset cap banner"
```

---

## Task 13: KYC Gate & Upgrade Flow UI

**Files:**
- Create: `src/app/(app)/kyc-required/page.tsx`
- Create: `src/components/kyc/PersonaKycFlow.tsx`
- Create: `src/components/kyc/PersonaKybFlow.tsx`
- Create: `src/components/billing/UpgradeFlow.tsx`
- Modify: `src/components/layout/TestModeToggle.tsx`

- [ ] **Step 1: Create Persona KYC flow component**

Create `src/components/kyc/PersonaKycFlow.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';

interface PersonaKycFlowProps {
  onComplete: () => void;
  onError?: (error: string) => void;
}

export function PersonaKycFlow({ onComplete, onError }: PersonaKycFlowProps) {
  const { update: updateSession } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startInquiry = useCallback(async () => {
    try {
      const res = await fetch('/api/kyc/start', { method: 'POST' });
      const data = await res.json();

      if (data.status === 'already_completed') {
        await updateSession();
        onComplete();
        return;
      }

      if (!data.inquiryId) {
        throw new Error('Failed to start KYC');
      }

      // Load Persona embedded flow
      // @ts-ignore — Persona SDK loaded via script tag
      const client = new window.Persona.Client({
        inquiryId: data.inquiryId,
        sessionToken: data.sessionToken,
        environment: process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT || 'sandbox',
        onComplete: async () => {
          await updateSession();
          onComplete();
        },
        onError: (err: any) => {
          setError(err.message || 'Verification failed');
          onError?.(err.message);
        },
      });

      client.open();
      setLoading(false);
    } catch (err: any) {
      setError(err.message || 'Failed to start verification');
      onError?.(err.message);
    }
  }, [onComplete, onError, updateSession]);

  useEffect(() => {
    // Load Persona SDK script
    const script = document.createElement('script');
    script.src = 'https://cdn.withpersona.com/dist/persona-v5.0.0.js';
    script.onload = () => startInquiry();
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [startInquiry]);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={startInquiry}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading verification...</div>;
  }

  return <div ref={containerRef} />;
}
```

- [ ] **Step 2: Create Persona KYB flow component**

Create `src/components/kyc/PersonaKybFlow.tsx` — same pattern as KYC but calls `/api/kyb/start` instead.

- [ ] **Step 3: Create KYC required gate page**

Create `src/app/(app)/kyc-required/page.tsx`:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PersonaKycFlow } from '@/components/kyc/PersonaKycFlow';
import { Shield } from 'lucide-react';

export default function KycRequiredPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const handleComplete = () => {
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <Shield className="w-16 h-16 text-primary mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Identity Verification Required</h1>
          <p className="text-muted-foreground mt-2">
            Your organization has upgraded to a paid plan. Please complete identity verification to access the platform.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <PersonaKycFlow onComplete={handleComplete} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create UpgradeFlow component**

Create `src/components/billing/UpgradeFlow.tsx`:

Multi-step component that orchestrates: KYB (if needed) → KYC (if needed) → Stripe Checkout redirect.

```tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { PersonaKybFlow } from '@/components/kyc/PersonaKybFlow';
import { PersonaKycFlow } from '@/components/kyc/PersonaKycFlow';
import { TierSlug, TIERS } from '@/lib/billing/tiers';

type UpgradeStep = 'kyb' | 'kyc' | 'checkout' | 'complete';

interface UpgradeFlowProps {
  targetTier: TierSlug;
  onCancel: () => void;
}

export function UpgradeFlow({ targetTier, onCancel }: UpgradeFlowProps) {
  const { data: session } = useSession();
  const router = useRouter();

  // Determine starting step based on current verification status
  const kybDone = session?.user?.kyb_status === 'completed';
  const kycDone = session?.user?.kyc_status === 'completed';

  const initialStep: UpgradeStep = !kybDone ? 'kyb' : !kycDone ? 'kyc' : 'checkout';
  const [step, setStep] = useState<UpgradeStep>(initialStep);
  const [loading, setLoading] = useState(false);

  const handleKybComplete = () => setStep('kyc');
  const handleKycComplete = () => setStep('checkout');

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTier }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Checkout failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-trigger checkout if KYB+KYC already done
  useEffect(() => {
    if (step === 'checkout' && !loading) {
      handleCheckout();
    }
  }, [step, loading]);

  const tierDef = TIERS[targetTier];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Upgrade to {tierDef.name}</h2>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>

        {/* Progress steps */}
        <div className="flex items-center gap-2 mb-6">
          {['Business Verification', 'Identity Verification', 'Payment'].map((label, i) => {
            const steps: UpgradeStep[] = ['kyb', 'kyc', 'checkout'];
            const stepIndex = steps.indexOf(step);
            const isActive = i === stepIndex;
            const isDone = i < stepIndex || (i === 0 && kybDone) || (i === 1 && kycDone);

            return (
              <div key={label} className="flex-1">
                <div className={`h-1 rounded-full mb-1 ${isDone ? 'bg-primary' : isActive ? 'bg-primary/50' : 'bg-muted'}`} />
                <p className={`text-xs ${isActive ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {label}
                </p>
              </div>
            );
          })}
        </div>

        {step === 'kyb' && (
          <PersonaKybFlow onComplete={handleKybComplete} />
        )}
        {step === 'kyc' && (
          <PersonaKycFlow onComplete={handleKycComplete} />
        )}
        {step === 'checkout' && (
          <div className="text-center py-8 text-muted-foreground">
            Redirecting to payment...
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Disable live mode toggle for Lite tier**

Modify `src/components/layout/TestModeToggle.tsx` — wrap the toggle with a check:

```tsx
// If tier is 'lite', disable the toggle and show tooltip
const tier = session?.user?.subscription_tier;

if (tier === 'lite') {
  return (
    <div className="relative group">
      <button disabled className="opacity-50 cursor-not-allowed ...existing-classes">
        {/* existing toggle UI */}
        Test
      </button>
      <div className="absolute hidden group-hover:block top-full mt-1 right-0 bg-popover border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground shadow-lg whitespace-nowrap z-50">
        Upgrade to a paid plan to access live mode
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/kyc-required/ src/components/kyc/ src/components/billing/UpgradeFlow.tsx src/components/layout/TestModeToggle.tsx
git commit -m "feat: add KYC gate page, Persona KYC/KYB flows, upgrade flow, and Lite toggle lock"
```

---

## Task 14: Monthly Invoice PDF & Email

**Files:**
- Create: `src/lib/billing/invoice-pdf.ts`
- Create: `src/lib/email/send.ts`
- Create: `src/lib/email/templates/monthly-bill.ts`
- Modify: `src/app/api/webhooks/stripe/route.ts` (wire up `handleInvoicePaid`)

- [ ] **Step 1: Create email send utility**

Create `src/lib/email/send.ts`:

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const USE_MOCK = process.env.RESEND_USE_MOCK === 'true';

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}) {
  if (USE_MOCK) {
    console.log('[MOCK EMAIL]', { to: params.to, subject: params.subject });
    return { id: 'mock-' + Date.now() };
  }

  const result = await resend.emails.send({
    from: 'Vantor <billing@vantor.xyz>',
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: params.attachments?.map(a => ({
      filename: a.filename,
      content: a.content,
    })),
  });

  return result;
}
```

- [ ] **Step 2: Create monthly bill email template**

Create `src/lib/email/templates/monthly-bill.ts`:

```typescript
export function monthlyBillEmailHtml(params: {
  enterpriseName: string;
  billingPeriod: string;
  totalAmount: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="padding:32px 32px 24px;border-bottom:1px solid #eee">
      <img src="https://www.vantor.xyz/logo.png" alt="Vantor" style="height:32px" />
    </div>
    <div style="padding:32px">
      <h1 style="font-size:20px;color:#111;margin:0 0 8px">Monthly Invoice</h1>
      <p style="color:#666;font-size:14px;margin:0 0 24px">
        Your invoice for <strong>${params.billingPeriod}</strong> is attached.
      </p>
      <div style="background:#f0faf9;border:1px solid #19595b33;border-radius:8px;padding:20px;text-align:center">
        <p style="color:#666;font-size:12px;margin:0 0 4px">Total Amount</p>
        <p style="font-size:28px;font-weight:700;color:#19595b;margin:0">${params.totalAmount}</p>
      </div>
      <p style="color:#666;font-size:13px;margin:24px 0 0">
        For detailed transaction records, log in to <a href="https://app.vantor.xyz" style="color:#19595b">app.vantor.xyz</a>
      </p>
    </div>
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">&copy; ${new Date().getFullYear()} Vantor. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 3: Create invoice PDF generator**

Create `src/lib/billing/invoice-pdf.ts`:

This uses `@react-pdf/renderer` (already installed) to generate a one-page PDF. The function accepts billing data and returns a Buffer.

```typescript
import { renderToBuffer } from '@react-pdf/renderer';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import React from 'react';

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#19595b' },
  subtitle: { fontSize: 10, color: '#666', marginTop: 4 },
  billTo: { marginBottom: 20 },
  billToLabel: { fontSize: 8, color: '#999', marginBottom: 2 },
  billToName: { fontSize: 12, fontWeight: 'bold' },
  table: { marginTop: 10 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#ddd', paddingBottom: 6, marginBottom: 6 },
  tableRow: { flexDirection: 'row', paddingVertical: 4 },
  colDesc: { flex: 3 },
  colAmount: { flex: 1, textAlign: 'right' },
  totalRow: { flexDirection: 'row', borderTopWidth: 2, borderColor: '#19595b', paddingTop: 8, marginTop: 8 },
  totalLabel: { flex: 3, fontWeight: 'bold', fontSize: 12 },
  totalAmount: { flex: 1, textAlign: 'right', fontWeight: 'bold', fontSize: 12, color: '#19595b' },
  footer: { position: 'absolute', bottom: 40, left: 40, right: 40, textAlign: 'center', fontSize: 8, color: '#999' },
});

interface InvoiceData {
  enterpriseName: string;
  billingPeriod: string;
  tierName: string;
  subscriptionCost: number;
  erpAddons: number;
  erpAddonCost: number;
  rampCount: number;
  rampFees: number;
  swapCount: number;
  swapFees: number;
  bridgeCount: number;
  bridgeFees: number;
  cardLast4?: string;
}

function InvoicePdf({ data }: { data: InvoiceData }) {
  const total = data.subscriptionCost + data.erpAddonCost + data.rampFees + data.swapFees + data.bridgeFees;
  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>VANTOR</Text>
            <Text style={styles.subtitle}>Treasury Management Platform</Text>
          </View>
          <View>
            <Text style={{ fontSize: 16, fontWeight: 'bold' }}>Invoice</Text>
            <Text style={styles.subtitle}>{data.billingPeriod}</Text>
          </View>
        </View>

        <View style={styles.billTo}>
          <Text style={styles.billToLabel}>BILL TO</Text>
          <Text style={styles.billToName}>{data.enterpriseName}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.colDesc, { fontWeight: 'bold', color: '#666' }]}>Description</Text>
            <Text style={[styles.colAmount, { fontWeight: 'bold', color: '#666' }]}>Amount</Text>
          </View>

          <View style={styles.tableRow}>
            <Text style={styles.colDesc}>Subscription: {data.tierName}</Text>
            <Text style={styles.colAmount}>{fmt(data.subscriptionCost)}</Text>
          </View>

          {data.erpAddons > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>ERP Add-ons ({data.erpAddons} additional)</Text>
              <Text style={styles.colAmount}>{fmt(data.erpAddonCost)}</Text>
            </View>
          )}

          {data.rampCount > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>Ramp fees ({data.rampCount} transactions)</Text>
              <Text style={styles.colAmount}>{fmt(data.rampFees)}</Text>
            </View>
          )}

          {data.swapCount > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>Swap fees ({data.swapCount} transactions)</Text>
              <Text style={styles.colAmount}>{fmt(data.swapFees)}</Text>
            </View>
          )}

          {data.bridgeCount > 0 && (
            <View style={styles.tableRow}>
              <Text style={styles.colDesc}>Bridge fees ({data.bridgeCount} transactions)</Text>
              <Text style={styles.colAmount}>{fmt(data.bridgeFees)}</Text>
            </View>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{fmt(total)}</Text>
          </View>
        </View>

        {data.cardLast4 && (
          <View style={{ marginTop: 20 }}>
            <Text style={{ color: '#666', fontSize: 9 }}>
              Charged to card ending in {data.cardLast4}
            </Text>
          </View>
        )}

        <Text style={styles.footer}>
          For detailed transaction records, log in to app.vantor.xyz
        </Text>
      </Page>
    </Document>
  );
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf data={data} />);
}
```

- [ ] **Step 4: Wire up handleInvoicePaid in Stripe webhook**

Update the `handleInvoicePaid` function in `src/app/api/webhooks/stripe/route.ts`:

```typescript
import { generateInvoicePdf } from '@/lib/billing/invoice-pdf';
import { sendEmail } from '@/lib/email/send';
import { monthlyBillEmailHtml } from '@/lib/email/templates/monthly-bill';
import { TIERS, TierSlug } from '@/lib/billing/tiers';

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return;

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('enterprise_id, tier, custom_price')
    .eq('stripe_subscription_id', invoice.subscription)
    .single();

  if (!sub) return;

  const { data: enterprise } = await supabaseAdmin
    .from('enterprises')
    .select('name')
    .eq('id', sub.enterprise_id)
    .single();

  // Get treasury_manager email
  const { data: manager } = await supabaseAdmin
    .from('user_profiles')
    .select('email')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('role', 'treasury_manager')
    .limit(1)
    .single();

  if (!manager?.email) return;

  // Aggregate usage fees
  const periodStart = new Date(invoice.period_start * 1000);
  const billingPeriod = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
    .toISOString()
    .split('T')[0];

  const { data: fees } = await supabaseAdmin
    .from('usage_fees')
    .select('transaction_type, fee_amount')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('billing_period', billingPeriod);

  const byType: Record<string, { count: number; total: number }> = {
    ramp: { count: 0, total: 0 },
    swap: { count: 0, total: 0 },
    bridge: { count: 0, total: 0 },
  };
  for (const fee of fees || []) {
    if (byType[fee.transaction_type]) {
      byType[fee.transaction_type].count++;
      byType[fee.transaction_type].total += Number(fee.fee_amount);
    }
  }

  // ERP add-ons
  const { count: erpAddons } = await supabaseAdmin
    .from('erp_addons')
    .select('id', { count: 'exact', head: true })
    .eq('enterprise_id', sub.enterprise_id)
    .eq('active', true);

  // Get payment method
  const { data: pm } = await supabaseAdmin
    .from('payment_methods')
    .select('card_last4')
    .eq('enterprise_id', sub.enterprise_id)
    .eq('is_default', true)
    .single();

  const tierDef = TIERS[sub.tier as TierSlug];
  const subscriptionCost = tierDef.price ? tierDef.price / 100 : (sub.custom_price || 0);

  const periodLabel = periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Generate PDF
  const pdfBuffer = await generateInvoicePdf({
    enterpriseName: enterprise?.name || 'Unknown',
    billingPeriod: periodLabel,
    tierName: tierDef.name,
    subscriptionCost,
    erpAddons: erpAddons || 0,
    erpAddonCost: (erpAddons || 0) * 1500,
    rampCount: byType.ramp.count,
    rampFees: byType.ramp.total,
    swapCount: byType.swap.count,
    swapFees: byType.swap.total,
    bridgeCount: byType.bridge.count,
    bridgeFees: byType.bridge.total,
    cardLast4: pm?.card_last4,
  });

  const totalAmount = subscriptionCost + (erpAddons || 0) * 1500 +
    byType.ramp.total + byType.swap.total + byType.bridge.total;

  // Send email with PDF
  await sendEmail({
    to: manager.email,
    subject: `Vantor Invoice — ${periodLabel}`,
    html: monthlyBillEmailHtml({
      enterpriseName: enterprise?.name || '',
      billingPeriod: periodLabel,
      totalAmount: `$${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    }),
    attachments: [{
      filename: `vantor-invoice-${billingPeriod}.pdf`,
      content: pdfBuffer,
    }],
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/invoice-pdf.ts src/lib/email/ src/app/api/webhooks/stripe/route.ts
git commit -m "feat: add monthly invoice PDF generation and email via Resend"
```

---

## Task 15: Admin Invite Flow

**Files:**
- Create: `src/app/api/admin/invitations/route.ts`
- Create: `src/components/admin/InviteUserForm.tsx`
- Create: `src/lib/email/templates/invitation.ts`

- [ ] **Step 1: Create invitation email template**

Create `src/lib/email/templates/invitation.ts`:

```typescript
export function invitationEmailHtml(params: {
  inviterName: string;
  signupUrl: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f7f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="padding:32px 32px 24px;border-bottom:1px solid #eee">
      <img src="https://www.vantor.xyz/logo.png" alt="Vantor" style="height:32px" />
    </div>
    <div style="padding:32px;text-align:center">
      <h1 style="font-size:22px;color:#111;margin:0 0 12px">You&rsquo;re Invited to Vantor</h1>
      <p style="color:#666;font-size:14px;margin:0 0 28px;line-height:1.5">
        ${params.inviterName} has invited you to join Vantor, the stablecoin treasury management platform.
      </p>
      <a href="${params.signupUrl}" style="display:inline-block;padding:14px 32px;background:#19595b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
        Sign Up for Vantor
      </a>
      <p style="color:#999;font-size:12px;margin:24px 0 0">
        This invitation expires in 7 days.
      </p>
    </div>
    <div style="padding:16px 32px;background:#fafafa;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">&copy; ${new Date().getFullYear()} Vantor. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}
```

- [ ] **Step 2: Create invitations API route**

Create `src/app/api/admin/invitations/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/send';
import { invitationEmailHtml } from '@/lib/email/templates/invitation';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST — send invitation
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_app_admin) {
    return NextResponse.json({ error: 'App admin required' }, { status: 403 });
  }

  const { email } = await req.json();
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  // Check if already invited (pending)
  const { data: existing } = await supabaseAdmin
    .from('invitations')
    .select('id')
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
    .single();

  if (existing) {
    return NextResponse.json({ error: 'Invitation already pending for this email' }, { status: 409 });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await supabaseAdmin.from('invitations').insert({
    email: email.toLowerCase(),
    invited_by: session.user.id,
    inviter_email: session.user.email,
    token,
    status: 'pending',
    expires_at: expiresAt.toISOString(),
  });

  const signupUrl = `${process.env.NEXTAUTH_URL}/register?invite=${token}&email=${encodeURIComponent(email)}`;

  await sendEmail({
    to: email,
    subject: "You're invited to join Vantor",
    html: invitationEmailHtml({
      inviterName: session.user.name || 'A Vantor admin',
      signupUrl,
    }),
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

// GET — list invitations
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_app_admin) {
    return NextResponse.json({ error: 'App admin required' }, { status: 403 });
  }

  const { data: invitations } = await supabaseAdmin
    .from('invitations')
    .select('id, email, status, expires_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ invitations: invitations || [] });
}
```

- [ ] **Step 3: Create InviteUserForm component**

Create `src/components/admin/InviteUserForm.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

export function InviteUserForm() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const res = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setSuccess(true);
        setEmail('');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to send invitation');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter email address"
        required
        className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-white text-sm font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
      >
        <Send className="w-4 h-4" />
        {loading ? 'Sending...' : 'Invite'}
      </button>
      {success && <p className="text-sm text-emerald-500 self-center">Sent!</p>}
      {error && <p className="text-sm text-red-500 self-center">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Integrate InviteUserForm into admin panel**

Add the `InviteUserForm` component to the existing admin page. Find the admin page (likely at `src/app/(app)/admin/page.tsx`) and add an "Invite Users" section.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/invitations/ src/components/admin/InviteUserForm.tsx src/lib/email/templates/invitation.ts
git commit -m "feat: add admin invite flow with branded email and signup link"
```

---

## Task 16: ERP Add-On Billing

**Files:**
- Modify: `src/app/(app)/settings/erp/page.tsx`

- [ ] **Step 1: Add ERP cost confirmation modal to ERP settings**

Modify `src/app/(app)/settings/erp/page.tsx` — in the `onSubmit` handler (around lines 161-187), before the existing POST call, check if this is a 2nd+ live ERP and show a confirmation:

```tsx
// Add state for confirmation modal
const [showErpAddonConfirm, setShowErpAddonConfirm] = useState(false);
const [pendingErpData, setPendingErpData] = useState<any>(null);

// In onSubmit, before the API call:
const isTestMode = /* check test mode */;
if (!isTestMode) {
  // Check current live ERP count
  const countRes = await fetch('/api/billing/asset-cap'); // or a dedicated endpoint
  // If count >= 1 (included), show confirmation modal
  if (currentLiveErpCount >= 1) {
    setPendingErpData(formData);
    setShowErpAddonConfirm(true);
    return;
  }
}

// Confirmation modal JSX (add before closing div):
{showErpAddonConfirm && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div className="bg-card border border-border rounded-xl shadow-xl p-6 max-w-md mx-4">
      <h3 className="text-lg font-semibold mb-2">Additional ERP Cost</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Adding an additional ERP integration costs <strong>$1,500/month</strong>.
        This will be added to your next bill, pro-rated for the remaining days this month.
      </p>
      <div className="flex gap-3 justify-end">
        <button
          onClick={() => setShowErpAddonConfirm(false)}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted"
        >
          Cancel
        </button>
        <button
          onClick={async () => {
            setShowErpAddonConfirm(false);
            // Proceed with ERP creation + Stripe add-on
            await handleErpAddonConfirmed(pendingErpData);
          }}
          className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
        >
          Agree & Add
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(app)/settings/erp/page.tsx
git commit -m "feat: add ERP add-on cost confirmation modal ($1,500/mo per additional ERP)"
```

---

## Task 17: Admin Enterprise Plan Management

**Files:**
- Create: `src/app/api/admin/enterprise/[id]/plan/route.ts`

- [ ] **Step 1: Create the admin plan management route**

Create `src/app/api/admin/enterprise/[id]/plan/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/supabase/admin';

// PATCH — set custom enterprise price and activate
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.is_app_admin) {
    return NextResponse.json({ error: 'App admin required' }, { status: 403 });
  }

  const { customPriceUsd } = await req.json();

  if (!customPriceUsd || typeof customPriceUsd !== 'number' || customPriceUsd <= 0) {
    return NextResponse.json({ error: 'Valid custom price required' }, { status: 400 });
  }

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('enterprise_id', params.id)
    .single();

  if (!sub) {
    return NextResponse.json({ error: 'Enterprise subscription not found' }, { status: 404 });
  }

  // Create custom Stripe price for this enterprise
  const price = await stripe.prices.create({
    unit_amount: Math.round(customPriceUsd * 100),
    currency: 'usd',
    recurring: { interval: 'month' },
    product: process.env.STRIPE_PRODUCT_ENTERPRISE!,
    metadata: { enterprise_id: params.id },
  });

  if (sub.stripe_subscription_id) {
    // Update existing subscription
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: stripeSub.items.data[0].id, price: price.id }],
    });
  } else if (sub.stripe_customer_id) {
    // Create new subscription
    const stripeSub = await stripe.subscriptions.create({
      customer: sub.stripe_customer_id,
      items: [{ price: price.id }],
      billing_cycle_anchor: getNextFirstOfMonth(),
    });

    await supabaseAdmin
      .from('subscriptions')
      .update({
        stripe_subscription_id: stripeSub.id,
        tier: 'enterprise',
        status: 'active',
        custom_price: customPriceUsd,
        updated_at: new Date().toISOString(),
      })
      .eq('enterprise_id', params.id);
  }

  // Update enterprise tier
  await supabaseAdmin
    .from('enterprises')
    .update({ subscription_tier: 'enterprise' })
    .eq('id', params.id);

  await supabaseAdmin
    .from('subscriptions')
    .update({ custom_price: customPriceUsd, tier: 'enterprise', updated_at: new Date().toISOString() })
    .eq('enterprise_id', params.id);

  return NextResponse.json({ success: true });
}

function getNextFirstOfMonth(): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Math.floor(next.getTime() / 1000);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/enterprise/
git commit -m "feat: add admin route for setting enterprise custom pricing"
```

---

## Task 18: KYC Login Gate Middleware

**Files:**
- Modify: `src/app/(app)/layout.tsx` or create middleware

- [ ] **Step 1: Add KYC gate check to app layout**

The app uses `AppShell` as the layout wrapper. Add a check that redirects non-KYC'd users on paid enterprises to `/kyc-required`.

Find the `AppShell` component (likely in `src/components/layout/AppShell.tsx`) and add:

```tsx
'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { isPaidTier } from '@/lib/billing/tiers';

// Inside AppShell component, add:
const { data: session } = useSession();
const router = useRouter();
const pathname = usePathname();

useEffect(() => {
  if (!session?.user) return;

  const tier = session.user.subscription_tier;
  const kycStatus = session.user.kyc_status;

  // If on a paid tier and KYC not completed, redirect to KYC gate
  if (isPaidTier(tier) && kycStatus !== 'completed' && pathname !== '/kyc-required') {
    router.replace('/kyc-required');
  }
}, [session, pathname, router]);
```

- [ ] **Step 2: Add session staleness header check**

In the API middleware or a shared fetch wrapper, check for `x-session-stale: true` response header and trigger a session refresh:

```typescript
// In a shared API hook or wrapper:
const response = await fetch(url, options);
if (response.headers.get('x-session-stale') === 'true') {
  // Trigger session refresh
  await updateSession();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat: add KYC login gate - redirect non-verified users on paid tiers"
```

---

## Task 19: Environment Variables & Stripe Product Setup

**Files:**
- Document required env vars

- [ ] **Step 1: Document all required environment variables**

Add to `.env.local` (do NOT commit):

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRODUCT_STARTER=prod_...
STRIPE_PRODUCT_GROWTH=prod_...
STRIPE_PRODUCT_SCALE=prod_...
STRIPE_PRODUCT_ENTERPRISE=prod_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_SCALE=price_...

# Persona
PERSONA_API_KEY=persona_...
PERSONA_WEBHOOK_SECRET=...
PERSONA_KYC_TEMPLATE_ID=itmpl_...
PERSONA_KYB_TEMPLATE_ID=itmpl_...
PERSONA_ENVIRONMENT_ID=env_...
NEXT_PUBLIC_PERSONA_ENVIRONMENT=sandbox
```

- [ ] **Step 2: Create Stripe products and prices**

This must be done manually in Stripe Dashboard or via a setup script:

1. Create Product "Vantor Starter" with metadata `tier: starter` → create Price $950/mo
2. Create Product "Vantor Growth" with metadata `tier: growth` → create Price $2,000/mo
3. Create Product "Vantor Scale" with metadata `tier: scale` → create Price $5,000/mo
4. Create Product "Vantor Enterprise" with metadata `tier: enterprise` (prices created per-customer)
5. Create Product "ERP Add-on" → create Price $1,500/mo
6. Set up Stripe webhook endpoint pointing to `/api/webhooks/stripe` with events: `invoice.paid`, `invoice.created`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `payment_method.attached`, `payment_method.detached`

- [ ] **Step 3: Create Persona templates**

In Persona Dashboard:
1. Create KYC Inquiry Template (government ID + selfie)
2. Create KYB Inquiry Template (business verification + beneficial ownership)
3. Set up webhook endpoint pointing to `/api/webhooks/persona`
4. Note template IDs and webhook secret for env vars

- [ ] **Step 4: Commit env example**

```bash
# Add env vars to .env.example (no secrets)
git add .env.example
git commit -m "docs: add Stripe and Persona env var placeholders to .env.example"
```

---

## Task 20: Rate Limiting on Public Endpoints

**Files:**
- Modify: `src/app/api/auth/register/route.ts`
- Modify: `src/app/api/admin/invitations/route.ts`

- [ ] **Step 1: Add rate limiting to registration**

In `src/app/api/auth/register/route.ts`, add at the top of the POST handler:

```typescript
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/api/rate-limit';

// At the start of POST handler:
const ip = getClientIp(req.headers);
if (!checkRateLimit('register', ip, 5, 3600_000)) {  // 5 per hour per IP
  return rateLimitResponse();
}
```

- [ ] **Step 2: Add rate limiting to invitation acceptance**

The invitation token is validated in the register route when `inviteToken` is present — the existing rate limit on `/register` covers this.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/register/route.ts
git commit -m "feat: add rate limiting to registration endpoint (5/hour per IP)"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Database schema migration | `0015_billing_schema.sql` |
| 2 | Install deps + tier config | `tiers.ts`, `stripe.ts` |
| 3 | Feature gating module | `gate.ts`, `rbac.ts` |
| 4 | NextAuth JWT billing fields | `nextauth.config.ts` |
| 5 | Registration flow rework | `register/route.ts`, `RegisterForm.tsx`, `helpers.ts` |
| 6 | Stripe webhook handler | `webhooks/stripe/route.ts` |
| 7 | Persona webhook handler | `webhooks/persona/route.ts` |
| 8 | Billing API routes | `billing/*.ts` (6 routes) |
| 9 | KYC/KYB API routes | `kyc/`, `kyb/` (4 routes) |
| 10 | Transaction fee integration | `usage.ts`, quote/execute routes |
| 11 | Fee display in UI | `RampForm`, `SwapForm`, `TransactionDetailModal` |
| 12 | Billing settings UI | `billing/page.tsx`, 5 tab components, sidebar |
| 13 | KYC gate + upgrade flow | `kyc-required/page.tsx`, Persona flows, `UpgradeFlow` |
| 14 | Monthly invoice PDF + email | `invoice-pdf.ts`, email templates |
| 15 | Admin invite flow | `invitations/route.ts`, `InviteUserForm`, email template |
| 16 | ERP add-on billing | `erp/page.tsx` confirmation modal |
| 17 | Admin enterprise plan mgmt | `enterprise/[id]/plan/route.ts` |
| 18 | KYC login gate middleware | `AppShell.tsx` |
| 19 | Env vars + Stripe/Persona setup | `.env.example`, dashboard config |
| 20 | Rate limiting | `register/route.ts` |
