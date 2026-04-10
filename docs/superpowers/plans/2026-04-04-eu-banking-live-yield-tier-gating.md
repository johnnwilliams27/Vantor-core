# International Banking, Live Yield Data & Tier Gating — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe Financial Connections (US + EU) and Belvo (Brazil/Mexico) for international bank linking, remove Plaid, add BRL/MXN currency support, wire all yield protocols to live rate data, add Compound V3, gate Ondo USDY to non-US enterprises with external KYC, block Lite tier from all actions, and standardize the mock/sandbox/live environment model.

**Architecture:** Per-request runtime mode (`mock | sandbox | live`) derived from subscription tier + test mode cookie replaces per-integration `*_USE_MOCK` env flags. A Vercel Cron job fetches live yield rates every 60s into a cache table. Stripe Financial Connections and Belvo sit alongside each other as AIS providers, routed by enterprise country.

**Tech Stack:** Next.js 14, Supabase (Postgres), viem (on-chain reads), Stripe Financial Connections, Belvo API, @belvo/connect-widget, @stripe/stripe-js, Vercel Cron, Zustand, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-04-04-eu-banking-live-yield-tier-gating-design.md`

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0024_eu_banking_yield_tier.sql`
- Modify: `src/types/database.ts`

- [ ] **Step 1: Create migration file**

```sql
-- 0024_eu_banking_yield_tier.sql
-- Enterprise country
ALTER TABLE enterprises ADD COLUMN country TEXT;

-- Bank account provider tracking
ALTER TABLE bank_accounts ADD COLUMN banking_provider TEXT NOT NULL DEFAULT 'manual'
  CHECK (banking_provider IN ('stripe_fc', 'belvo', 'manual'));

-- Stripe Financial Connections fields
ALTER TABLE bank_accounts ADD COLUMN stripe_fc_account_id TEXT;
ALTER TABLE bank_accounts ADD COLUMN iban TEXT;

-- Belvo fields (Brazil/Mexico)
ALTER TABLE bank_accounts ADD COLUMN belvo_link_id TEXT;
ALTER TABLE bank_accounts ADD COLUMN belvo_account_id TEXT;

-- Yield rate cache
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

-- Ondo KYC tracking
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

- [ ] **Step 2: Update TypeScript types in `src/types/database.ts`**

Add `country` to Enterprise interface:

```typescript
export interface Enterprise {
  id: string;
  name: string;
  status: EnterpriseStatus;
  kyc_status: KycStatus;
  kyc_submitted_at: string | null;
  kyc_verified_at: string | null;
  country: string | null;  // ISO 3166-1 alpha-2
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

Add new fields to BankAccount interface:

```typescript
export interface BankAccount {
  id: string;
  user_id: string;
  plaid_item_id: string | null;
  plaid_account_id: string | null;
  institution_name: string;
  account_name: string;
  account_type: string;
  last4: string | null;
  routing_number: string | null;
  currency: string;
  is_active: boolean;
  verified_at: string | null;
  created_at: string;
  current_balance: string | null;
  balance_currency: string;
  balance_as_of: string | null;
  nickname: string | null;
  banking_provider: 'stripe_fc' | 'belvo' | 'manual';
  stripe_fc_account_id: string | null;
  iban: string | null;
  belvo_link_id: string | null;
  belvo_account_id: string | null;
}
```

Add OndoKycVerification interface:

```typescript
export interface OndoKycVerification {
  id: string;
  enterprise_id: string;
  wallet_address: string;
  status: 'pending' | 'verified';
  verified_at: string | null;
  created_at: string;
}
```

Add YieldRateCache interface:

```typescript
export interface YieldRateCache {
  id: string;
  protocol: string;
  token: string;
  chain: string;
  supply_apy: number;
  reward_apy: number;
  total_apy: number;
  fetched_at: string;
  is_stale: boolean;
}
```

- [ ] **Step 3: Run migration**

```bash
cd C:/Users/John/crypto-treasury && npm run migrate
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0024_eu_banking_yield_tier.sql src/types/database.ts
git commit -m "feat: add migration for EU banking, yield cache, Ondo KYC, enterprise country"
```

---

## Task 2: Integration Mode System

**Files:**
- Create: `src/lib/env/integration-mode.ts`
- Modify: `src/lib/banking/factory.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Create integration mode helper**

Create `src/lib/env/integration-mode.ts`:

```typescript
import { cookies } from 'next/headers';

export type IntegrationMode = 'mock' | 'sandbox' | 'live';

/**
 * Determines the integration mode for the current request.
 * - Lite tier → mock (dummy data, no API calls)
 * - Paid tier + test mode → sandbox (sandbox API calls)
 * - Paid tier + live mode → live (live API calls)
 * - FORCE_MOCK=true → mock (offline/CI escape hatch)
 */
export function getIntegrationMode(subscriptionTier: string): IntegrationMode {
  if (process.env.FORCE_MOCK === 'true') return 'mock';
  if (subscriptionTier === 'lite') return 'mock';

  const cookieStore = cookies();
  const isTestMode = cookieStore.get('vantor_test_mode')?.value === '1';
  return isTestMode ? 'sandbox' : 'live';
}

/**
 * Selects the correct credentials based on integration mode.
 */
export function getCredential(mode: IntegrationMode, sandboxKey: string | undefined, liveKey: string | undefined): string {
  if (mode === 'mock') return sandboxKey || '';
  return (mode === 'sandbox' ? sandboxKey : liveKey) || '';
}
```

- [ ] **Step 2: Update banking factory**

Replace `src/lib/banking/factory.ts`:

```typescript
import type { IBankingAdapter } from './interface';
import { BridgeMockAdapter } from './mock/bridge-mock';
import type { IntegrationMode } from '@/lib/env/integration-mode';

export function getBankingAdapter(mode: IntegrationMode = 'mock'): IBankingAdapter {
  if (mode === 'mock') {
    return new BridgeMockAdapter();
  }

  // TODO: Real Bridge adapter — for now fall back to mock
  // When implemented: return new BridgeAdapter(mode === 'sandbox' ? sandboxKeys : liveKeys);
  return new BridgeMockAdapter();
}
```

- [ ] **Step 3: Update `.env.local.example`**

Add the new credential pattern to `.env.local.example`. Keep existing vars for backwards compatibility during migration, add new ones:

```
# Integration Mode (set FORCE_MOCK=true for offline dev / CI)
FORCE_MOCK=false

# Stripe (existing — used for billing, payments, AND Financial Connections)
# Uses existing STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY
# Test keys (sk_test_*) = sandbox, Live keys (sk_live_*) = production

# Belvo (Brazil/Mexico)
BELVO_SECRET_KEY_ID_SANDBOX=
BELVO_SECRET_KEY_PASSWORD_SANDBOX=
BELVO_SECRET_KEY_ID_LIVE=
BELVO_SECRET_KEY_PASSWORD_LIVE=
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/env/integration-mode.ts src/lib/banking/factory.ts .env.local.example
git commit -m "feat: add integration mode system (mock/sandbox/live)"
```

---

## Task 3: Lite Tier Gate

**Files:**
- Create: `src/lib/auth/tier-gate.ts`
- Create: `src/components/ui/upgrade-gate.tsx`

- [ ] **Step 1: Create API-level tier gate helper**

Create `src/lib/auth/tier-gate.ts`:

```typescript
import { NextResponse } from 'next/server';

export class TierGateError extends Error {
  constructor(message = 'This action requires a paid plan') {
    super(message);
    this.name = 'TierGateError';
  }
}

/**
 * Throws TierGateError if the user is on the Lite (free) tier.
 * Call at the top of any POST route that executes an action.
 */
export function requirePaidTier(subscriptionTier: string): void {
  if (subscriptionTier === 'lite') {
    throw new TierGateError();
  }
}

/**
 * Returns a 403 response for Lite tier users attempting gated actions.
 */
export function tierGateResponse(feature?: string) {
  return NextResponse.json(
    {
      error: 'upgrade_required',
      message: feature
        ? `Upgrade to a paid plan to ${feature}`
        : 'This action requires a paid plan',
    },
    { status: 403 },
  );
}
```

- [ ] **Step 2: Create UI-level upgrade gate component**

Create `src/components/ui/upgrade-gate.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/store/appStore';
import { useRouter } from 'next/navigation';

interface UpgradeGateProps {
  children: ReactNode;
  feature?: string;
}

/**
 * Wraps an action button. For Lite tier users, replaces the action with
 * a lock icon + upgrade modal trigger. For paid tiers, renders children as-is.
 */
export function UpgradeGate({ children, feature }: UpgradeGateProps) {
  const tier = useAppStore((s) => s.subscriptionTier);
  const [showModal, setShowModal] = useState(false);

  if (tier !== 'lite') return <>{children}</>;

  return (
    <>
      <Button
        variant="secondary"
        className="w-full relative opacity-80"
        onClick={() => setShowModal(true)}
      >
        <Lock className="mr-2 h-3.5 w-3.5" />
        {feature || 'Upgrade to Unlock'}
        <span className="ml-2 text-[10px] font-semibold bg-teal-600/20 text-teal-400 px-1.5 py-0.5 rounded-full">
          PRO
        </span>
      </Button>

      {showModal && (
        <UpgradeModal
          feature={feature}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function UpgradeModal({ feature, onClose }: { feature?: string; onClose: () => void }) {
  const router = useRouter();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0a1628] border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-teal-600/20 flex items-center justify-center">
            <Lock className="h-5 w-5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold">Upgrade to Unlock</h3>
            {feature && (
              <p className="text-sm text-gray-400">{feature}</p>
            )}
          </div>
        </div>

        <p className="text-sm text-gray-400 mb-6">
          Paid plans include live bank connections, wallet linking, DeFi yield deposits,
          ramps, swaps, transfers, payments, and ERP integrations.
        </p>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Maybe Later
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onClose();
              router.push('/settings/billing');
            }}
          >
            View Plans
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add tier gate to key API routes**

Add `requirePaidTier` call to the top of these existing route handlers (after auth check, before business logic). Example pattern — apply to each route:

In `src/app/api/bank-accounts/plaid/exchange/route.ts`, after the session check add:

```typescript
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

// Inside the POST handler, after session check:
try { requirePaidTier(session.user.subscription_tier); }
catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }
```

Apply the same pattern to all these routes:
- `src/app/api/bank-accounts/route.ts` (POST handler) — "add a bank account"
- `src/app/api/ramps/execute/route.ts` — "execute ramps"
- `src/app/api/swaps/execute/route.ts` — "execute swaps"
- `src/app/api/bridges/execute/route.ts` — "execute bridges"
- `src/app/api/transfers/route.ts` (POST) — "create transfers"
- `src/app/api/payments/route.ts` (POST) — "send payments"
- `src/app/api/yield/deposit/route.ts` — "deposit into yield protocols"
- `src/app/api/yield/withdraw/route.ts` — "withdraw from yield protocols"
- `src/app/api/wallets/route.ts` (POST) — "connect wallets"
- `src/app/api/settings/erp/route.ts` (POST) — "connect ERP"

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth/tier-gate.ts src/components/ui/upgrade-gate.tsx
git add src/app/api/bank-accounts/ src/app/api/ramps/ src/app/api/swaps/
git add src/app/api/bridges/ src/app/api/transfers/ src/app/api/payments/
git add src/app/api/yield/ src/app/api/wallets/ src/app/api/settings/erp/
git commit -m "feat: add Lite tier gate — block all execute/link actions with upgrade CTA"
```

---

## Task 4: Enterprise Country via Persona Webhook

**Files:**
- Modify: `src/app/api/webhooks/persona/route.ts`

- [ ] **Step 1: Update KYB completion handler to extract country**

In `src/app/api/webhooks/persona/route.ts`, modify `handleInquiryCompleted` to extract the country from the Persona inquiry attributes and store it on the enterprise:

```typescript
async function handleInquiryCompleted(inquiry: any) {
  const inquiryId = inquiry?.id;
  if (!inquiryId) return;
  const supabaseAdmin = createAdminClient();

  // Check KYC first
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

  // Check KYB
  const { data: kyb } = await supabaseAdmin
    .from('kyb_verifications')
    .select('id, enterprise_id')
    .eq('persona_inquiry_id', inquiryId)
    .single();

  if (kyb) {
    await supabaseAdmin
      .from('kyb_verifications')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', kyb.id);

    // Extract country from Persona inquiry attributes
    // Persona KYB inquiries include address fields on the inquiry object
    const country =
      inquiry?.attributes?.fields?.address_country_code?.value  // Persona v2 format
      ?? inquiry?.attributes?.['country-code']                   // alternate field
      ?? null;

    if (country && kyb.enterprise_id) {
      await supabaseAdmin
        .from('enterprises')
        .update({ country: country.toUpperCase() })
        .eq('id', kyb.enterprise_id);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/webhooks/persona/route.ts
git commit -m "feat: extract enterprise country from Persona KYB webhook"
```

---

## Task 5: Stripe Financial Connections + Plaid Removal

**Files:**
- Create: `src/lib/banking/stripe-fc.ts`
- Create: `src/app/api/bank-accounts/stripe-fc/session/route.ts`
- Create: `src/app/api/bank-accounts/stripe-fc/link/route.ts`
- Delete: `src/lib/banking/plaid.ts`
- Delete: `src/app/api/bank-accounts/plaid/link-token/route.ts`
- Delete: `src/app/api/bank-accounts/plaid/exchange/route.ts`
- Modify: `src/components/banking/PlaidLinkButton.tsx` → rename to `BankLinkButton.tsx`

- [ ] **Step 1: Create Stripe Financial Connections client**

Create `src/lib/banking/stripe-fc.ts`:

```typescript
import Stripe from 'stripe';
import { getCredential, type IntegrationMode } from '@/lib/env/integration-mode';

// Countries where Belvo is used instead of Stripe FC
export const BELVO_COUNTRIES = ['BR', 'MX'];

export function getBankingProvider(country: string | null): 'stripe_fc' | 'belvo' | null {
  if (!country) return null;
  if (BELVO_COUNTRIES.includes(country)) return 'belvo';
  return 'stripe_fc'; // Stripe FC is the default for all other countries
}

function getStripeClient(mode: IntegrationMode): Stripe {
  const key = getCredential(
    mode,
    process.env.STRIPE_SECRET_KEY, // Sandbox uses same Stripe test key
    process.env.STRIPE_SECRET_KEY, // Live uses same key (Stripe uses test/live key prefixes)
  );
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

/**
 * Creates a Financial Connections session.
 * Returns the client secret for the frontend widget.
 */
export async function createFCSession(mode: IntegrationMode): Promise<{
  clientSecret: string;
  sessionId: string;
}> {
  const stripe = getStripeClient(mode);

  const session = await stripe.financialConnections.sessions.create({
    account_holder: { type: 'account' },
    permissions: ['balances', 'ownership', 'transactions'],
  });

  return {
    clientSecret: session.client_secret,
    sessionId: session.id,
  };
}

/**
 * Fetches a linked Financial Connections account.
 */
export async function getFCAccount(mode: IntegrationMode, accountId: string): Promise<{
  id: string;
  institutionName: string;
  displayName: string | null;
  accountType: string;
  currency: string | null;
  last4: string | null;
}> {
  const stripe = getStripeClient(mode);
  const account = await stripe.financialConnections.accounts.retrieve(accountId);

  return {
    id: account.id,
    institutionName: account.institution_name ?? 'Bank',
    displayName: account.display_name,
    accountType: account.subcategory ?? account.category ?? 'checking',
    currency: account.balance?.currency ?? null,
    last4: account.last4 ?? null,
  };
}

/**
 * Fetches balance for a Financial Connections account.
 * Triggers a refresh first, then reads the balance.
 */
export async function getFCBalance(mode: IntegrationMode, accountId: string): Promise<{
  current: number;
  available: number | null;
  currency: string;
}> {
  const stripe = getStripeClient(mode);

  // Trigger a balance refresh
  await stripe.financialConnections.accounts.refresh(accountId, {
    features: ['balance'],
  });

  // Read the updated account
  const account = await stripe.financialConnections.accounts.retrieve(accountId);
  const bal = account.balance;

  return {
    current: (bal?.current ?? 0) / 100, // Stripe amounts are in cents
    available: bal?.cash?.available ? Object.values(bal.cash.available)[0]! / 100 : null,
    currency: bal?.currency?.toUpperCase() ?? 'USD',
  };
}
```

- [ ] **Step 2: Create Stripe FC session route**

Create `src/app/api/bank-accounts/stripe-fc/session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { createFCSession } from '@/lib/banking/stripe-fc';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const mode = getIntegrationMode(session.user.subscription_tier);

  try {
    const { clientSecret } = await createFCSession(mode);
    return NextResponse.json({ data: { clientSecret } });
  } catch (err) {
    console.error('[stripe-fc/session]', err);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create Stripe FC link route**

Create `src/app/api/bank-accounts/stripe-fc/link/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { getFCAccount } from '@/lib/banking/stripe-fc';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const schema = z.object({
  accountIds: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const mode = getIntegrationMode(session.user.subscription_tier);
  const supabase = createAdminClient();

  try {
    for (const accountId of parsed.data.accountIds) {
      const acc = await getFCAccount(mode, accountId);

      await supabase.from('bank_accounts').insert({
        user_id: session.user.id,
        enterprise_id: session.user.enterprise_id,
        banking_provider: 'stripe_fc',
        stripe_fc_account_id: acc.id,
        institution_name: acc.institutionName,
        account_name: acc.displayName || 'Account',
        account_type: acc.accountType,
        currency: acc.currency || 'USD',
        last4: acc.last4,
        verified_at: new Date().toISOString(),
        is_active: true,
      });
    }

    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      action: 'bank_account_connect',
      details: { provider: 'stripe_fc', accounts_linked: parsed.data.accountIds.length },
    });

    return NextResponse.json({ data: { linked: parsed.data.accountIds.length } });
  } catch (err) {
    console.error('[stripe-fc/link]', err);
    return NextResponse.json({ error: 'Failed to link accounts' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Delete Plaid files and remove npm packages**

```bash
cd C:/Users/John/crypto-treasury
rm src/lib/banking/plaid.ts
rm -rf src/app/api/bank-accounts/plaid
npm uninstall plaid react-plaid-link
```

- [ ] **Step 5: Rename PlaidLinkButton to BankLinkButton with Stripe FC + Belvo routing**

Rename `src/components/banking/PlaidLinkButton.tsx` to `src/components/banking/BankLinkButton.tsx` and replace with:

```tsx
'use client';
import { useState, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Building2, Loader2, Globe } from 'lucide-react';
import { ManualBankForm } from './ManualBankForm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UpgradeGate } from '@/components/ui/upgrade-gate';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface BankLinkButtonProps {
  onSuccess: () => void;
  bankingProvider: 'stripe_fc' | 'belvo' | null;
}

export function BankLinkButton({ onSuccess, bankingProvider }: BankLinkButtonProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showManual, setShowManual] = useState(false);

  // --- Stripe Financial Connections flow ---
  const startStripeFC = useCallback(async () => {
    setLoading(true);
    try {
      // Get session from backend
      const res = await fetch('/api/bank-accounts/stripe-fc/session', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);

      const stripe = await stripePromise;
      if (!stripe) throw new Error('Stripe not loaded');

      // Open Financial Connections widget
      const result = await stripe.collectFinancialConnectionsAccounts({
        clientSecret: json.data.clientSecret,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      // Save linked accounts
      const accountIds = result.financialConnectionsSession.accounts.map((a) => a.id);
      const linkRes = await fetch('/api/bank-accounts/stripe-fc/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountIds }),
      });
      if (!linkRes.ok) throw new Error('Failed to save accounts');

      toast({ title: 'Bank account connected', variant: 'success' });
      onSuccess();
    } catch (err) {
      toast({ title: 'Connection failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, onSuccess]);

  // No provider (no country / Lite tier)
  if (!bankingProvider) {
    return (
      <UpgradeGate feature="Link Bank Account">
        <Button className="w-full" disabled>
          <Building2 className="mr-2 h-4 w-4" />
          Connect Bank Account
        </Button>
      </UpgradeGate>
    );
  }

  // Manual fallback
  if (showManual) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Link Bank Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ManualBankForm onSuccess={onSuccess} />
        </CardContent>
      </Card>
    );
  }

  // Stripe Financial Connections flow (default for all non-Belvo countries)
  if (bankingProvider === 'stripe_fc') {
    return (
      <div className="space-y-3">
        <Button onClick={startStripeFC} disabled={loading} className="w-full">
          {loading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
          ) : (
            <><Building2 className="mr-2 h-4 w-4" />Connect Bank Account</>
          )}
        </Button>
        <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
          Add Manually Instead
        </Button>
      </div>
    );
  }

  // Belvo flow (Brazil/Mexico) — implemented in Task 13
  return (
    <div className="space-y-3">
      <Button onClick={() => {/* startBelvo — added in Task 13 */}} disabled={loading} className="w-full">
        {loading ? (
          <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
        ) : (
          <><Globe className="mr-2 h-4 w-4" />Connect Bank via Belvo</>
        )}
      </Button>
      <Button variant="outline" className="w-full" onClick={() => setShowManual(true)}>
        Add Manually Instead
      </Button>
    </div>
  );
}
```

- [ ] **Step 6: Update imports of PlaidLinkButton across the codebase**

Search for all imports of `PlaidLinkButton` and update to `BankLinkButton`:

```bash
cd C:/Users/John/crypto-treasury && grep -r "PlaidLinkButton\|plaidConfigured" src/ --include="*.tsx" --include="*.ts" -l
```

Update each import and replace `plaidConfigured` prop with `bankingProvider` prop derived from enterprise country.

- [ ] **Step 7: Commit**

```bash
git add src/lib/banking/stripe-fc.ts
git add src/app/api/bank-accounts/stripe-fc/
git add src/components/banking/BankLinkButton.tsx
git rm src/components/banking/PlaidLinkButton.tsx
git rm src/lib/banking/plaid.ts
git rm -r src/app/api/bank-accounts/plaid/
git add -u
git commit -m "feat: replace Plaid with Stripe Financial Connections, add bank linking for US+EU"
```

---

## Task 6: Add Compound V3 to Yield Protocols

**Files:**
- Modify: `src/lib/yield/interface.ts`
- Modify: `src/lib/yield/mock/yield-mock.ts`
- Modify: `src/lib/yield/slippage/liquidity-provider.ts`
- Modify: `src/lib/yield/factory.ts`

- [ ] **Step 1: Add compound_v3 to YieldProtocolId**

In `src/lib/yield/interface.ts`, add `'compound_v3'` to the union:

```typescript
export type YieldProtocolId =
  | 'aave_v3'
  | 'morpho'
  | 'morpho_steakhouse'
  | 'kamino'
  | 'kamino_multiply'
  | 'ondo'
  | 'sky'
  | 'ethena'
  | 'maple'
  | 'drift'
  | 'compound_v3';
```

- [ ] **Step 2: Add Compound metadata to mock adapter**

In `src/lib/yield/mock/yield-mock.ts`, add to `PROTOCOL_META`:

```typescript
  compound_v3: {
    name: 'Compound V3',
    chain: 'ethereum',
    supportedTokens: ['USDC', 'USDT'],
    description: 'Battle-tested lending protocol. Supply stablecoins to the Comet market and earn yield from borrowers.',
    riskLevel: 'low',
    riskFactors: { smartContract: 1, counterparty: 1, liquidity: 1, regulatory: 2 },
    kycRequired: false,
  },
```

Add to `MOCK_APYS`:

```typescript
  compound_v3:       { supply: 0.0440, reward: 0.0035 },
```

Add to `YIELD_TOKENS`:

```typescript
  compound_v3: 'cUSDCv3',
```

- [ ] **Step 3: Add Compound slippage pool data**

In `src/lib/yield/slippage/liquidity-provider.ts`, add to `MOCK_POOL_DATA`:

```typescript
  compound_v3:        { tvl: 1_800_000_000, utilization: 0.80, poolType: 'stablecoin' },
```

- [ ] **Step 4: Add Compound to factory**

In `src/lib/yield/factory.ts`, add `'compound_v3'` to `ALL_YIELD_PROTOCOLS`:

```typescript
export const ALL_YIELD_PROTOCOLS: YieldProtocolId[] = [
  'aave_v3',
  'compound_v3',
  'sky',
  'ondo',
  'morpho',
  'morpho_steakhouse',
  'kamino',
  'kamino_multiply',
  'maple',
  'ethena',
  'drift',
];
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/yield/interface.ts src/lib/yield/mock/yield-mock.ts
git add src/lib/yield/slippage/liquidity-provider.ts src/lib/yield/factory.ts
git commit -m "feat: add Compound V3 as yield protocol"
```

---

## Task 7: Live Yield Rate Fetchers

**Files:**
- Create: `src/lib/yield/rates/client.ts`
- Create: `src/lib/yield/rates/types.ts`
- Create: `src/lib/yield/rates/aave.ts`
- Create: `src/lib/yield/rates/compound.ts`
- Create: `src/lib/yield/rates/morpho.ts`
- Create: `src/lib/yield/rates/sky.ts`
- Create: `src/lib/yield/rates/ondo.ts`
- Create: `src/lib/yield/rates/ethena.ts`
- Create: `src/lib/yield/rates/maple.ts`
- Create: `src/lib/yield/rates/kamino.ts`
- Create: `src/lib/yield/rates/drift.ts`
- Create: `src/lib/yield/rates/index.ts`

- [ ] **Step 1: Create shared types and viem client**

Create `src/lib/yield/rates/types.ts`:

```typescript
export interface RateResult {
  protocol: string;
  token: string;
  chain: string;
  supplyAPY: number;
  rewardAPY: number;
}

export interface RateFetcher {
  fetchRates(): Promise<RateResult[]>;
}
```

Create `src/lib/yield/rates/client.ts`:

```typescript
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETHEREUM_RPC_URL),
});
```

- [ ] **Step 2: Create Aave V3 rate fetcher**

Create `src/lib/yield/rates/aave.ts`:

```typescript
import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

// Aave V3 Pool on Ethereum mainnet
const AAVE_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const;

// ABI for getReserveData — we only need currentLiquidityRate
const poolAbi = [
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'configuration', type: 'uint256' },
          { name: 'liquidityIndex', type: 'uint128' },
          { name: 'currentLiquidityRate', type: 'uint128' },
          { name: 'variableBorrowIndex', type: 'uint128' },
          { name: 'currentVariableBorrowRate', type: 'uint128' },
          { name: 'currentStableBorrowRate', type: 'uint128' },
          { name: 'lastUpdateTimestamp', type: 'uint40' },
          { name: 'id', type: 'uint16' },
          { name: 'aTokenAddress', type: 'address' },
          { name: 'stableDebtTokenAddress', type: 'address' },
          { name: 'variableDebtTokenAddress', type: 'address' },
          { name: 'interestRateStrategyAddress', type: 'address' },
          { name: 'accruedToTreasury', type: 'uint128' },
          { name: 'unbacked', type: 'uint128' },
          { name: 'isolationModeTotalDebt', type: 'uint128' },
        ],
      },
    ],
  },
] as const;

const TOKENS: Record<string, string> = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31536000;

function rayToAPY(rayRate: bigint): number {
  // Convert RAY-scaled per-second rate to annual APY
  const ratePerSecond = Number(rayRate) / Number(RAY);
  return Math.pow(1 + ratePerSecond / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
}

export const aaveFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const results = await ethereumClient.multicall({
      contracts: Object.entries(TOKENS).map(([, addr]) => ({
        address: AAVE_POOL,
        abi: poolAbi,
        functionName: 'getReserveData',
        args: [addr as `0x${string}`],
      })),
    });

    return Object.keys(TOKENS).map((token, i) => {
      const result = results[i];
      if (result.status !== 'success') throw new Error(`Aave getReserveData failed for ${token}`);
      const reserveData = result.result as any;
      const liquidityRate = reserveData.currentLiquidityRate ?? reserveData[2];
      return {
        protocol: 'aave_v3',
        token,
        chain: 'ethereum',
        supplyAPY: rayToAPY(BigInt(liquidityRate)),
        rewardAPY: 0, // Aave rewards vary — set to 0 for now, can add incentives controller read later
      };
    });
  },
};
```

- [ ] **Step 3: Create Compound V3 rate fetcher**

Create `src/lib/yield/rates/compound.ts`:

```typescript
import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

// Compound V3 Comet contracts (one per base asset)
const COMET_USDC = '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as const;
const COMET_USDT = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840' as const;

const cometAbi = [
  {
    name: 'getUtilization',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getSupplyRate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'utilization', type: 'uint256' }],
    outputs: [{ type: 'uint64' }],
  },
] as const;

const SECONDS_PER_YEAR = 31536000;

async function fetchCometRate(cometAddress: `0x${string}`, token: string): Promise<RateResult> {
  const utilization = await ethereumClient.readContract({
    address: cometAddress,
    abi: cometAbi,
    functionName: 'getUtilization',
  });

  const supplyRatePerSecond = await ethereumClient.readContract({
    address: cometAddress,
    abi: cometAbi,
    functionName: 'getSupplyRate',
    args: [utilization],
  });

  // Rate is per-second, scaled by 1e18
  const ratePerSecond = Number(supplyRatePerSecond) / 1e18;
  const apy = Math.pow(1 + ratePerSecond, SECONDS_PER_YEAR) - 1;

  return {
    protocol: 'compound_v3',
    token,
    chain: 'ethereum',
    supplyAPY: apy,
    rewardAPY: 0, // COMP rewards require reading CometRewards contract — add later
  };
}

export const compoundFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const [usdc, usdt] = await Promise.all([
      fetchCometRate(COMET_USDC, 'USDC'),
      fetchCometRate(COMET_USDT, 'USDT'),
    ]);
    return [usdc, usdt];
  },
};
```

- [ ] **Step 4: Create Morpho rate fetcher**

Create `src/lib/yield/rates/morpho.ts`:

```typescript
import type { RateFetcher, RateResult } from './types';

const MORPHO_GRAPHQL_URL = 'https://blue-api.morpho.org/graphql';

// Curated USDC/USDT market IDs on Ethereum — these are the main lending markets
// Update if Morpho adds new primary markets
const MARKET_FILTERS = {
  USDC: { loanToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  USDT: { loanToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7' },
};

// Steakhouse USDC vault address
const STEAKHOUSE_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';

const MARKETS_QUERY = `
  query {
    markets(where: { chainId_in: [1], whitelisted: true }) {
      items {
        uniqueKey
        loanAsset { address symbol }
        state { supplyApy netSupplyApy }
      }
    }
    vaults(where: { chainId_in: [1], address_in: ["${STEAKHOUSE_VAULT}"] }) {
      items {
        address
        name
        state { apy netApy }
        asset { symbol }
      }
    }
  }
`;

export const morphoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(MORPHO_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: MARKETS_QUERY }),
    });

    if (!res.ok) throw new Error(`Morpho API error: ${res.status}`);
    const data = await res.json();

    const results: RateResult[] = [];

    // Morpho Blue markets — find best USDC and USDT markets
    const markets = data.data?.markets?.items || [];
    for (const [token, filter] of Object.entries(MARKET_FILTERS)) {
      const matching = markets.filter(
        (m: any) => m.loanAsset?.address?.toLowerCase() === filter.loanToken.toLowerCase(),
      );
      // Pick the market with the highest supply APY
      const best = matching.sort((a: any, b: any) =>
        (b.state?.supplyApy || 0) - (a.state?.supplyApy || 0),
      )[0];

      if (best) {
        results.push({
          protocol: 'morpho',
          token,
          chain: 'ethereum',
          supplyAPY: best.state?.supplyApy || 0,
          rewardAPY: Math.max(0, (best.state?.netSupplyApy || 0) - (best.state?.supplyApy || 0)),
        });
      }
    }

    // Steakhouse vault
    const vaults = data.data?.vaults?.items || [];
    const steakhouse = vaults[0];
    if (steakhouse) {
      results.push({
        protocol: 'morpho_steakhouse',
        token: 'USDC',
        chain: 'ethereum',
        supplyAPY: steakhouse.state?.apy || 0,
        rewardAPY: Math.max(0, (steakhouse.state?.netApy || 0) - (steakhouse.state?.apy || 0)),
      });
    }

    return results;
  },
};
```

- [ ] **Step 5: Create Sky sUSDS rate fetcher**

Create `src/lib/yield/rates/sky.ts`:

```typescript
import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

// sUSDS contract on Ethereum mainnet
const SUSDS_ADDRESS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD' as const;

const susdsAbi = [
  {
    name: 'ssr',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 365 * 24 * 3600;

export const skyFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const ssr = await ethereumClient.readContract({
      address: SUSDS_ADDRESS,
      abi: susdsAbi,
      functionName: 'ssr',
    });

    // ssr is a per-second RAY-scaled rate
    // APY = (ssr / 1e27) ^ seconds_per_year - 1
    const ssrNum = Number(ssr) / Number(RAY);
    const apy = Math.pow(ssrNum, SECONDS_PER_YEAR) - 1;

    return [
      { protocol: 'sky', token: 'USDC', chain: 'ethereum', supplyAPY: apy, rewardAPY: 0 },
      { protocol: 'sky', token: 'USDT', chain: 'ethereum', supplyAPY: apy, rewardAPY: 0 },
    ];
  },
};
```

- [ ] **Step 6: Create Ondo USDY rate fetcher**

Create `src/lib/yield/rates/ondo.ts`:

```typescript
import { ethereumClient } from './client';
import type { RateFetcher, RateResult } from './types';

// Ondo RWA Dynamic Oracle — returns USDY price which accrues daily
const ONDO_ORACLE = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as const;

const oracleAbi = [
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// We estimate APY from the price accrual. USDY started at $1.00 and accrues daily.
// The oracle returns the current price scaled by 1e18.
// Approximate method: compare current price to $1.00 base, annualize the accrual.
// More precise: track price over time. For now, use the simpler Fed Funds approximation.
const USDY_BASE_PRICE = 1.0;

export const ondoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const priceRaw = await ethereumClient.readContract({
      address: ONDO_ORACLE,
      abi: oracleAbi,
      functionName: 'getPrice',
    });

    const currentPrice = Number(priceRaw) / 1e18;

    // USDY launched ~Jan 2024. Estimate annualized rate from price accrual.
    // This is approximate — in production, track daily price deltas for a rolling 7d APY.
    const daysSinceLaunch = (Date.now() - new Date('2024-01-23').getTime()) / (1000 * 86400);
    const totalReturn = currentPrice / USDY_BASE_PRICE - 1;
    const apy = Math.pow(1 + totalReturn, 365 / daysSinceLaunch) - 1;

    return [
      { protocol: 'ondo', token: 'USDC', chain: 'ethereum', supplyAPY: apy, rewardAPY: 0 },
    ];
  },
};
```

- [ ] **Step 7: Create Ethena sUSDe rate fetcher**

Create `src/lib/yield/rates/ethena.ts`:

```typescript
import type { RateFetcher, RateResult } from './types';

const ETHENA_API_URL = 'https://ethena.fi/api/yields/protocol-and-staking-yield';

export const ethenaFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(ETHENA_API_URL);
    if (!res.ok) throw new Error(`Ethena API error: ${res.status}`);

    const data = await res.json();

    // Ethena returns stakingYield as a percentage object
    // The exact shape may vary — extract the sUSDe APY
    const stakingYield = data.stakingYield?.value ?? data.stakingYield ?? 0;
    const apy = typeof stakingYield === 'number' && stakingYield > 1
      ? stakingYield / 100  // Convert percentage to decimal if needed
      : stakingYield;

    return [
      { protocol: 'ethena', token: 'USDC', chain: 'ethereum', supplyAPY: apy, rewardAPY: 0 },
      { protocol: 'ethena', token: 'USDT', chain: 'ethereum', supplyAPY: apy, rewardAPY: 0 },
    ];
  },
};
```

- [ ] **Step 8: Create Maple Finance rate fetcher**

Create `src/lib/yield/rates/maple.ts`:

```typescript
import type { RateFetcher, RateResult } from './types';

const MAPLE_GRAPHQL_URL = 'https://api.maple.finance/v2/graphql';

const POOLS_QUERY = `
  query {
    pools(where: { chain: "ethereum", asset: "USDC", status: "active" }) {
      id
      name
      apy
      tvl
    }
  }
`;

export const mapleFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(MAPLE_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: POOLS_QUERY }),
    });

    if (!res.ok) throw new Error(`Maple API error: ${res.status}`);
    const data = await res.json();

    const pools = data.data?.pools || [];
    // Pick the pool with the highest TVL as the primary lending pool
    const bestPool = pools.sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))[0];

    if (!bestPool) {
      throw new Error('No active Maple USDC pools found');
    }

    const apy = (bestPool.apy || 0) / 100; // Convert percentage to decimal

    return [
      { protocol: 'maple', token: 'USDC', chain: 'ethereum', supplyAPY: apy, rewardAPY: 0 },
    ];
  },
};
```

- [ ] **Step 9: Create Kamino rate fetcher**

Create `src/lib/yield/rates/kamino.ts`:

```typescript
import type { RateFetcher, RateResult } from './types';

// Kamino main lending market on Solana
const KAMINO_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const KAMINO_API_URL = `https://api.kamino.finance/kamino-market/${KAMINO_MARKET}/reserves`;

export const kaminoFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    const res = await fetch(KAMINO_API_URL);
    if (!res.ok) throw new Error(`Kamino API error: ${res.status}`);

    const reserves: any[] = await res.json();
    const results: RateResult[] = [];

    for (const token of ['USDC', 'USDT']) {
      const reserve = reserves.find(
        (r: any) => r.symbol?.toUpperCase() === token || r.tokenSymbol?.toUpperCase() === token,
      );
      if (reserve) {
        results.push({
          protocol: 'kamino',
          token,
          chain: 'solana',
          supplyAPY: reserve.supplyInterestAPY ?? reserve.metrics?.supplyInterestAPY ?? 0,
          rewardAPY: 0,
        });
      }
    }

    // Kamino Multiply — uses a separate vault, approximate with a multiplier on the base rate
    const usdcReserve = reserves.find(
      (r: any) => r.symbol?.toUpperCase() === 'USDC' || r.tokenSymbol?.toUpperCase() === 'USDC',
    );
    if (usdcReserve) {
      const baseApy = usdcReserve.supplyInterestAPY ?? usdcReserve.metrics?.supplyInterestAPY ?? 0;
      results.push({
        protocol: 'kamino_multiply',
        token: 'USDC',
        chain: 'solana',
        supplyAPY: baseApy * 2.5, // Leveraged strategy approximation
        rewardAPY: 0,
      });
    }

    return results;
  },
};
```

- [ ] **Step 10: Create Drift rate fetcher**

Create `src/lib/yield/rates/drift.ts`:

```typescript
import type { RateFetcher, RateResult } from './types';

const DRIFT_API_URL = 'https://mainnet-beta.api.drift.trade';

export const driftFetcher: RateFetcher = {
  async fetchRates(): Promise<RateResult[]> {
    // Drift spot market index 0 = USDC
    const res = await fetch(`${DRIFT_API_URL}/spotMarketRate?marketIndex=0`);
    if (!res.ok) throw new Error(`Drift API error: ${res.status}`);

    const data = await res.json();
    const depositRate = data.depositRate ?? data.rate ?? 0;

    // Drift returns annualized rate as a decimal
    const apy = typeof depositRate === 'number' && depositRate > 1
      ? depositRate / 100
      : depositRate;

    return [
      { protocol: 'drift', token: 'USDC', chain: 'solana', supplyAPY: apy, rewardAPY: 0 },
    ];
  },
};
```

- [ ] **Step 11: Create rate fetcher index**

Create `src/lib/yield/rates/index.ts`:

```typescript
import { aaveFetcher } from './aave';
import { compoundFetcher } from './compound';
import { morphoFetcher } from './morpho';
import { skyFetcher } from './sky';
import { ondoFetcher } from './ondo';
import { ethenaFetcher } from './ethena';
import { mapleFetcher } from './maple';
import { kaminoFetcher } from './kamino';
import { driftFetcher } from './drift';
import type { RateFetcher, RateResult } from './types';

export type { RateResult, RateFetcher };

export const ALL_RATE_FETCHERS: { name: string; fetcher: RateFetcher }[] = [
  { name: 'aave', fetcher: aaveFetcher },
  { name: 'compound', fetcher: compoundFetcher },
  { name: 'morpho', fetcher: morphoFetcher },
  { name: 'sky', fetcher: skyFetcher },
  { name: 'ondo', fetcher: ondoFetcher },
  { name: 'ethena', fetcher: ethenaFetcher },
  { name: 'maple', fetcher: mapleFetcher },
  { name: 'kamino', fetcher: kaminoFetcher },
  { name: 'drift', fetcher: driftFetcher },
];

/**
 * Fetches rates from all protocols in parallel.
 * Returns successful results and logs failures.
 */
export async function fetchAllRates(): Promise<{
  rates: RateResult[];
  failures: { name: string; error: string }[];
}> {
  const settled = await Promise.allSettled(
    ALL_RATE_FETCHERS.map(async ({ name, fetcher }) => {
      const rates = await fetcher.fetchRates();
      return { name, rates };
    }),
  );

  const rates: RateResult[] = [];
  const failures: { name: string; error: string }[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      rates.push(...result.value.rates);
    } else {
      // Extract fetcher name from the original array index
      const idx = settled.indexOf(result);
      const name = ALL_RATE_FETCHERS[idx]?.name ?? 'unknown';
      failures.push({ name, error: result.reason?.message || String(result.reason) });
    }
  }

  return { rates, failures };
}
```

- [ ] **Step 12: Commit**

```bash
git add src/lib/yield/rates/
git commit -m "feat: add live rate fetchers for all 11 yield protocols"
```

---

## Task 8: Yield Rate Cron Job

**Files:**
- Create: `src/app/api/cron/yield-rates/route.ts`
- Modify: `vercel.json`
- Modify: `src/app/api/yield/rates/route.ts`

- [ ] **Step 1: Create cron endpoint**

Create `src/app/api/cron/yield-rates/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllRates } from '@/lib/yield/rates';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { rates, failures } = await fetchAllRates();

  // Upsert successful rates
  for (const rate of rates) {
    await supabase
      .from('yield_rate_cache')
      .upsert(
        {
          protocol: rate.protocol,
          token: rate.token,
          chain: rate.chain,
          supply_apy: rate.supplyAPY,
          reward_apy: rate.rewardAPY,
          total_apy: rate.supplyAPY + rate.rewardAPY,
          fetched_at: new Date().toISOString(),
          is_stale: false,
        },
        { onConflict: 'protocol,token,chain' },
      );
  }

  // Mark failed protocols as stale (keep last known rate)
  for (const failure of failures) {
    console.error(`[cron/yield-rates] ${failure.name} failed: ${failure.error}`);
    await supabase
      .from('yield_rate_cache')
      .update({ is_stale: true })
      .eq('protocol', failure.name);
  }

  return NextResponse.json({
    updated: rates.length,
    failed: failures.length,
    failures: failures.map((f) => f.name),
  });
}
```

- [ ] **Step 2: Add cron to vercel.json**

Add to the `crons` array in `vercel.json`:

```json
{
  "path": "/api/cron/yield-rates",
  "schedule": "* * * * *"
}
```

- [ ] **Step 3: Update yield rates API to read from cache**

Replace `src/app/api/yield/rates/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { getYieldAdapter, ALL_YIELD_PROTOCOLS } from '@/lib/yield/factory';
import type { YieldRate } from '@/lib/yield/interface';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  if (!checkRateLimit('yield-rates', session.user.id, 30, 3600_000)) {
    return rateLimitResponse();
  }

  const supabase = createAdminClient();

  // Try cache first
  const { data: cached } = await supabase
    .from('yield_rate_cache')
    .select('*')
    .order('protocol');

  if (cached && cached.length > 0) {
    // Filter Ondo for non-US enterprises only
    const enterpriseId = session.user.enterprise_id;
    let enterpriseCountry: string | null = null;
    if (enterpriseId) {
      const { data: ent } = await supabase
        .from('enterprises')
        .select('country')
        .eq('id', enterpriseId)
        .single();
      enterpriseCountry = ent?.country ?? null;
    }

    const rates: (YieldRate & { isStale: boolean })[] = cached
      .filter((row) => {
        // Hide Ondo if enterprise is US or has no country set
        if (row.protocol === 'ondo') {
          return enterpriseCountry && enterpriseCountry !== 'US';
        }
        return true;
      })
      .map((row) => ({
        protocol: row.protocol as any,
        token: row.token as any,
        chain: row.chain as any,
        supplyAPY: Number(row.supply_apy),
        rewardAPY: Number(row.reward_apy),
        totalAPY: Number(row.total_apy),
        fetchedAt: row.fetched_at,
        isStale: row.is_stale,
      }));

    return NextResponse.json({ data: rates });
  }

  // Fallback to mock data if cache is empty (cron hasn't run yet)
  const rates = await Promise.all(
    ALL_YIELD_PROTOCOLS.flatMap((pid) => {
      const adapter = getYieldAdapter(pid);
      const info = adapter.getInfo();
      return info.supportedTokens.map((t) => adapter.getAPY(t));
    }),
  );

  return NextResponse.json({ data: rates.map((r) => ({ ...r, isStale: false })) });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/yield-rates/route.ts vercel.json src/app/api/yield/rates/route.ts
git commit -m "feat: add yield rate cron job and switch API to read from cache"
```

---

## Task 9: Ondo USDY KYC Flow

**Files:**
- Create: `src/app/api/yield/ondo/verify-kyc/route.ts`
- Create: `src/app/api/yield/ondo/kyc-status/route.ts`

- [ ] **Step 1: Create Ondo KYC verify endpoint**

Create `src/app/api/yield/ondo/verify-kyc/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { createAdminClient } from '@/lib/supabase/admin';
import { ethereumClient } from '@/lib/yield/rates/client';
import { z } from 'zod';

// USDY token contract — has an allowlist for transfers
const USDY_TOKEN = '0x96F6eF951840721AdBF46Ac996b59E0235CB985C' as const;

const allowlistAbi = [
  {
    name: 'isAllowed',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const schema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('verify Ondo KYC'); throw e; }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });

  const { walletAddress } = parsed.data;
  const enterpriseId = session.user.enterprise_id;
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  // Check on-chain allowlist
  let isAllowed = false;
  try {
    isAllowed = await ethereumClient.readContract({
      address: USDY_TOKEN,
      abi: allowlistAbi,
      functionName: 'isAllowed',
      args: [walletAddress as `0x${string}`],
    });
  } catch (err) {
    console.error('[ondo/verify-kyc] On-chain read failed:', err);
    return NextResponse.json({
      verified: false,
      message: 'Unable to verify on-chain allowlist. Please try again later.',
    });
  }

  const supabase = createAdminClient();

  if (isAllowed) {
    await supabase.from('ondo_kyc_verifications').upsert(
      {
        enterprise_id: enterpriseId,
        wallet_address: walletAddress.toLowerCase(),
        status: 'verified',
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'enterprise_id,wallet_address' },
    );

    return NextResponse.json({ verified: true });
  }

  // Not whitelisted yet — save as pending so we know they've attempted
  await supabase.from('ondo_kyc_verifications').upsert(
    {
      enterprise_id: enterpriseId,
      wallet_address: walletAddress.toLowerCase(),
      status: 'pending',
    },
    { onConflict: 'enterprise_id,wallet_address' },
  );

  return NextResponse.json({
    verified: false,
    message: 'Your wallet is not yet whitelisted by Ondo. It may take time for Ondo to process your verification. Try again later.',
  });
}
```

- [ ] **Step 2: Create Ondo KYC status endpoint**

Create `src/app/api/yield/ondo/kyc-status/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const enterpriseId = session.user.enterprise_id;
  if (!enterpriseId) return NextResponse.json({ data: [] });

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('ondo_kyc_verifications')
    .select('wallet_address, status, verified_at')
    .eq('enterprise_id', enterpriseId);

  return NextResponse.json({ data: data || [] });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/yield/ondo/
git commit -m "feat: add Ondo USDY KYC verification flow with on-chain allowlist check"
```

---

## Task 10: UI Updates — Yield Rate Staleness & Ondo KYC

**Files:**
- Modify: `src/components/yield/YieldRatesTable.tsx`

- [ ] **Step 1: Add staleness indicator and Ondo KYC UI to YieldRatesTable**

This task modifies the existing `YieldRatesTable.tsx`. The specific changes are:

1. **Rate timestamp**: Add a "Rates as of X seconds ago" line at the top of the rates display. The `fetchedAt` field is already in the `YieldRate` type. Compute the oldest `fetchedAt` across all rates and display it as a relative time.

2. **Stale badge**: If a rate has `isStale: true`, show an amber "Stale" badge next to the APY value.

3. **Ondo KYC flow**: When the user clicks "Deposit" on the Ondo tile:
   - Fetch Ondo KYC status from `/api/yield/ondo/kyc-status`
   - If the selected wallet is verified → proceed to deposit form normally
   - If not → show a modal with:
     - "Ondo requires separate identity verification"
     - Link to ondo.finance (opens in new tab)
     - "I've completed Ondo KYC" button that calls `/api/yield/ondo/verify-kyc`
     - Show result (verified → close modal & show green badge, not verified → show message)
   - If wallet is verified, show a green "KYC Verified" badge on the Ondo tile

4. **Ondo tile badge**: On the Ondo protocol card, if KYC is verified for any wallet, show a green check badge: "Ondo KYC Verified"

The exact JSX changes depend on the current structure of YieldRatesTable.tsx (472 lines). The implementing engineer should read the file, locate the protocol card rendering section and the deposit button handler, and integrate these changes following the existing component patterns.

- [ ] **Step 2: Add UpgradeGate wrapping to deposit/withdraw buttons**

In `YieldRatesTable.tsx`, wrap the "Deposit" button with `<UpgradeGate feature="Deposit into Yield">`. In `YieldPositionList.tsx`, wrap the "Withdraw" button with `<UpgradeGate feature="Withdraw from Yield">`.

- [ ] **Step 3: Commit**

```bash
git add src/components/yield/YieldRatesTable.tsx src/components/yield/YieldPositionList.tsx
git commit -m "feat: add yield rate staleness indicators, Ondo KYC flow, and upgrade gates"
```

---

## Task 11: Update Balance Refresh for Stripe FC Accounts

**Files:**
- Modify: `src/app/api/bank-accounts/[id]/refresh-balance/route.ts`

- [ ] **Step 1: Route balance refresh by banking provider**

Update the existing balance refresh route to check `banking_provider` on the account and call the appropriate provider:

```typescript
// After fetching the bank account from the database, add provider routing:

if (bankAccount.banking_provider === 'stripe_fc') {
  const { getFCBalance } = await import('@/lib/banking/stripe-fc');
  const { getIntegrationMode } = await import('@/lib/env/integration-mode');

  const mode = getIntegrationMode(session.user.subscription_tier);
  const balance = await getFCBalance(mode, bankAccount.stripe_fc_account_id!);

  await supabase.from('bank_accounts').update({
    current_balance: balance.current,
    balance_currency: balance.currency,
    balance_as_of: new Date().toISOString(),
  }).eq('id', bankAccount.id);

  return NextResponse.json({ data: { balance: balance.current, currency: balance.currency } });
}

// Belvo flow handled in Task 13, manual accounts have no auto-refresh
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/bank-accounts/[id]/refresh-balance/route.ts
git commit -m "feat: route balance refresh to Stripe FC for linked bank accounts"
```

---

## Task 12: Environment Cleanup & Final Config

**Files:**
- Modify: `.env.local.example`
- Modify: `.env.local` (local only, not committed)

- [ ] **Step 1: Update .env.local.example with complete credential pattern**

Update `.env.local.example` to reflect the new dual-key pattern. Add a comment block at the top explaining the mode system:

```
# =============================================================================
# Integration Mode
# =============================================================================
# Runtime mode is determined per-request by customer tier + test mode toggle:
#   Lite tier         → mock (dummy data, no API calls)
#   Paid + test mode  → sandbox (sandbox API calls)
#   Paid + live mode  → live (live API calls)
#
# Set FORCE_MOCK=true for offline development or CI (overrides all modes to mock)
FORCE_MOCK=false
```

Add the TrueLayer, dual-key Plaid, and other new env vars per the spec.

- [ ] **Step 2: Update local .env.local with sandbox credentials**

Update your local `.env.local` to use the new variable names. Keep existing vars working until all code is migrated.

- [ ] **Step 3: Verify build**

```bash
cd C:/Users/John/crypto-treasury && npm run build
```

Fix any TypeScript or import errors.

- [ ] **Step 4: Commit**

```bash
git add .env.local.example vercel.json
git commit -m "feat: update env config for mock/sandbox/live mode system"
```

---

---

## Task 13: Belvo Integration (Brazil & Mexico)

**Files:**
- Create: `src/lib/banking/belvo.ts`
- Create: `src/app/api/bank-accounts/belvo/widget-token/route.ts`
- Create: `src/app/api/bank-accounts/belvo/link/route.ts`

- [ ] **Step 1: Install Belvo Connect widget**

```bash
cd C:/Users/John/crypto-treasury && npm install @belvo/connect-widget
```

- [ ] **Step 2: Create Belvo API client**

Create `src/lib/banking/belvo.ts`:

```typescript
import { getCredential, type IntegrationMode } from '@/lib/env/integration-mode';

const BELVO_API_URL = 'https://api.belvo.com';
const BELVO_API_URL_SANDBOX = 'https://sandbox.belvo.com';

function getBaseUrl(mode: IntegrationMode): string {
  return mode === 'live' ? BELVO_API_URL : BELVO_API_URL_SANDBOX;
}

function getAuth(mode: IntegrationMode): string {
  const keyId = getCredential(mode, process.env.BELVO_SECRET_KEY_ID_SANDBOX, process.env.BELVO_SECRET_KEY_ID_LIVE);
  const keyPassword = getCredential(mode, process.env.BELVO_SECRET_KEY_PASSWORD_SANDBOX, process.env.BELVO_SECRET_KEY_PASSWORD_LIVE);
  return Buffer.from(`${keyId}:${keyPassword}`).toString('base64');
}

/**
 * Creates a widget access token for the Belvo Connect widget.
 */
export async function createWidgetToken(mode: IntegrationMode): Promise<string> {
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}/api/token/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${getAuth(mode)}`,
    },
    body: JSON.stringify({
      id: getCredential(mode, process.env.BELVO_SECRET_KEY_ID_SANDBOX, process.env.BELVO_SECRET_KEY_ID_LIVE),
      password: getCredential(mode, process.env.BELVO_SECRET_KEY_PASSWORD_SANDBOX, process.env.BELVO_SECRET_KEY_PASSWORD_LIVE),
      scopes: 'read_institutions,read_accounts,read_balances',
    }),
  });

  if (!res.ok) throw new Error(`Belvo token creation failed: ${await res.text()}`);
  const data = await res.json();
  return data.access;
}

/**
 * Retrieves accounts for a Belvo link.
 */
export async function getAccounts(mode: IntegrationMode, linkId: string): Promise<{
  accountId: string;
  name: string;
  type: string;
  currency: string;
  institution: string;
  number: string | null;
}[]> {
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}/api/accounts/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${getAuth(mode)}`,
    },
    body: JSON.stringify({ link: linkId }),
  });

  if (!res.ok) throw new Error(`Belvo accounts fetch failed: ${await res.text()}`);
  const data = await res.json();

  return (Array.isArray(data) ? data : [data]).map((acc: any) => ({
    accountId: acc.id,
    name: acc.name || 'Account',
    type: acc.type || 'checking',
    currency: acc.currency || 'BRL',
    institution: acc.institution?.name || 'Bank',
    number: acc.number || null,
  }));
}

/**
 * Retrieves balances for a Belvo link.
 */
export async function getBalances(mode: IntegrationMode, linkId: string, accountId: string): Promise<{
  current: number;
  available: number;
  currency: string;
}> {
  const baseUrl = getBaseUrl(mode);
  const res = await fetch(`${baseUrl}/api/balances/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${getAuth(mode)}`,
    },
    body: JSON.stringify({
      link: linkId,
      date_from: new Date().toISOString().split('T')[0],
      date_to: new Date().toISOString().split('T')[0],
    }),
  });

  if (!res.ok) throw new Error(`Belvo balances fetch failed: ${await res.text()}`);
  const data = await res.json();

  // Find the matching account balance
  const balance = (Array.isArray(data) ? data : [data]).find(
    (b: any) => b.account?.id === accountId,
  );

  return {
    current: balance?.current_balance ?? 0,
    available: balance?.available_balance ?? 0,
    currency: balance?.currency || 'BRL',
  };
}
```

- [ ] **Step 3: Create Belvo widget token route**

Create `src/app/api/bank-accounts/belvo/widget-token/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { createWidgetToken } from '@/lib/banking/belvo';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const mode = getIntegrationMode(session.user.subscription_tier);

  try {
    const token = await createWidgetToken(mode);
    return NextResponse.json({ data: { accessToken: token } });
  } catch (err) {
    console.error('[belvo/widget-token]', err);
    return NextResponse.json({ error: 'Failed to create Belvo widget token' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Create Belvo link route**

Create `src/app/api/bank-accounts/belvo/link/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { requireRole } from '@/lib/auth/rbac';
import { requirePaidTier, TierGateError, tierGateResponse } from '@/lib/auth/tier-gate';
import { getIntegrationMode } from '@/lib/env/integration-mode';
import { getAccounts } from '@/lib/banking/belvo';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const schema = z.object({
  linkId: z.string().uuid(),
  institution: z.string(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('link a bank account'); throw e; }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const { linkId, institution } = parsed.data;
  const mode = getIntegrationMode(session.user.subscription_tier);
  const supabase = createAdminClient();

  try {
    const accounts = await getAccounts(mode, linkId);

    for (const acc of accounts) {
      await supabase.from('bank_accounts').insert({
        user_id: session.user.id,
        enterprise_id: session.user.enterprise_id,
        banking_provider: 'belvo',
        institution_name: acc.institution || institution,
        account_name: acc.name,
        account_type: acc.type,
        currency: acc.currency,
        last4: acc.number ? acc.number.slice(-4) : null,
        belvo_link_id: linkId,
        belvo_account_id: acc.accountId,
        verified_at: new Date().toISOString(),
        is_active: true,
      });
    }

    await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      enterprise_id: session.user.enterprise_id,
      action: 'bank_account_connect',
      details: { provider: 'belvo', institution, accounts_linked: accounts.length },
    });

    return NextResponse.json({ data: { linked: accounts.length } });
  } catch (err) {
    console.error('[belvo/link]', err);
    return NextResponse.json({ error: 'Failed to link Belvo accounts' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Add Belvo `startBelvo` handler to BankLinkButton**

In `src/components/banking/BankLinkButton.tsx`, add the Belvo flow handler alongside the TrueLayer handler. The Belvo flow uses the `@belvo/connect-widget`:

```typescript
// Add import at top of BankLinkButton.tsx
import { createWidget } from '@belvo/connect-widget';

// Add startBelvo handler inside the component
const startBelvo = useCallback(async () => {
  setLoading(true);
  try {
    const res = await fetch('/api/bank-accounts/belvo/widget-token', { method: 'POST' });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);

    const widget = createWidget(json.data.accessToken, {
      callback: async (link: string, institution: string) => {
        // Link created — save accounts
        try {
          const linkRes = await fetch('/api/bank-accounts/belvo/link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ linkId: link, institution }),
          });
          if (!linkRes.ok) throw new Error('Failed to save accounts');
          toast({ title: 'Bank account connected', variant: 'success' });
          onSuccess();
        } catch (err) {
          toast({ title: 'Failed to save accounts', description: (err as Error).message, variant: 'destructive' });
        }
      },
      onExit: () => setLoading(false),
      onEvent: () => {},
    });

    widget.open();
  } catch (err) {
    toast({ title: 'Failed to start Belvo', description: (err as Error).message, variant: 'destructive' });
    setLoading(false);
  }
}, [toast, onSuccess]);
```

- [ ] **Step 6: Add Belvo balance refresh to refresh-balance route**

In `src/app/api/bank-accounts/[id]/refresh-balance/route.ts`, add a Belvo branch alongside the TrueLayer branch:

```typescript
if (bankAccount.banking_provider === 'belvo') {
  const { getBalances } = await import('@/lib/banking/belvo');
  const { getIntegrationMode } = await import('@/lib/env/integration-mode');

  const mode = getIntegrationMode(session.user.subscription_tier);
  const balance = await getBalances(mode, bankAccount.belvo_link_id!, bankAccount.belvo_account_id!);

  await supabase.from('bank_accounts').update({
    current_balance: balance.current,
    balance_currency: balance.currency,
    balance_as_of: new Date().toISOString(),
  }).eq('id', bankAccount.id);

  return NextResponse.json({ data: { balance: balance.current, currency: balance.currency } });
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/banking/belvo.ts src/app/api/bank-accounts/belvo/
git add src/components/banking/BankLinkButton.tsx
git add src/app/api/bank-accounts/[id]/refresh-balance/route.ts
git commit -m "feat: add Belvo integration for Brazilian and Mexican bank account linking"
```

---

## Task 14: BRL/MXN Currency Support

**Files:**
- Modify: `src/lib/fx/rates.ts`
- Modify: `src/components/banking/RampForm.tsx`
- Modify: `src/components/banking/ScheduleRampForm.tsx`
- Modify: `src/components/payments/SendPaymentForm.tsx`
- Modify: `src/components/payments/SchedulePaymentForm.tsx`
- Modify: `src/components/invoices/InvoiceTable.tsx`

- [ ] **Step 1: Update currency constants and FX rates**

In `src/lib/fx/rates.ts`, replace the entire file:

```typescript
export const SUPPORTED_FIAT_CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN'] as const;
export type FiatCurrency = (typeof SUPPORTED_FIAT_CURRENCIES)[number];

/**
 * Mock FX rates relative to USD.
 * In production, replace with a real FX API (e.g., exchangeratesapi.io).
 */
const MOCK_RATES: Record<FiatCurrency, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  BRL: 5.05,
  MXN: 17.15,
};

export function getMockFxRates(): Record<FiatCurrency, number> {
  return { ...MOCK_RATES };
}

export function getFxRate(from: FiatCurrency, to: FiatCurrency): number {
  if (from === to) return 1;
  const fromToUsd = 1 / MOCK_RATES[from];
  return fromToUsd * MOCK_RATES[to];
}

export function convertFiat(amount: number, from: FiatCurrency, to: FiatCurrency): number {
  return amount * getFxRate(from, to);
}

const CURRENCY_SYMBOLS: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  BRL: 'R$',
  MXN: 'MX$',
};

export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency as FiatCurrency] ?? currency;
}

export function formatFiatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
```

- [ ] **Step 2: Update all form Zod schemas with new currencies**

In each of these files, find `z.enum(['USD', 'EUR', 'GBP'])` and replace with `z.enum(['USD', 'EUR', 'GBP', 'BRL', 'MXN'])`:

- `src/components/banking/RampForm.tsx`
- `src/components/banking/ScheduleRampForm.tsx`
- `src/components/payments/SendPaymentForm.tsx`
- `src/components/payments/SchedulePaymentForm.tsx`

Also in `RampForm.tsx`, update any inline currency symbol maps:
```typescript
// Replace
const currSym = { USD: '$', EUR: '€', GBP: '£' }[data.fiatCurrency] ?? data.fiatCurrency;
// With
const currSym = { USD: '$', EUR: '€', GBP: '£', BRL: 'R$', MXN: 'MX$' }[data.fiatCurrency] ?? data.fiatCurrency;
```

- [ ] **Step 3: Update InvoiceTable currencies**

In `src/components/invoices/InvoiceTable.tsx`, update the `CURRENCIES` array:

```typescript
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'USDC', 'USDT'] as const;
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/fx/rates.ts
git add src/components/banking/RampForm.tsx src/components/banking/ScheduleRampForm.tsx
git add src/components/payments/SendPaymentForm.tsx src/components/payments/SchedulePaymentForm.tsx
git add src/components/invoices/InvoiceTable.tsx
git commit -m "feat: add BRL and MXN currency support throughout the app"
```

---

## Task 15: BRL/MXN Seed Data

**Files:**
- Modify: `src/lib/test-mode/seed/banking.ts`
- Modify: `src/lib/test-mode/seed/transactions.ts`
- Modify: `src/lib/test-mode/seed/erp.ts`

- [ ] **Step 1: Add Brazilian and Mexican bank accounts to banking seed**

In `src/lib/test-mode/seed/banking.ts`, add to the bank accounts array:

```typescript
// Add alongside existing accounts (Chase, SVB, Mercury, Barclays, HSBC, Deutsche Bank)
{
  institution_name: 'Itaú Unibanco',
  account_name: 'Conta Corrente',
  account_type: 'checking',
  currency: 'BRL',
  last4: '7823',
  current_balance: '1415400.00',  // R$1,415,400
  balance_currency: 'BRL',
  nickname: 'Itaú BRL Primary',
  banking_provider: 'belvo',
},
{
  institution_name: 'Nubank',
  account_name: 'Conta PJ',
  account_type: 'checking',
  currency: 'BRL',
  last4: '3491',
  current_balance: '479775.00',  // R$479,775
  balance_currency: 'BRL',
  nickname: 'Nubank BRL Operations',
  banking_provider: 'belvo',
},
{
  institution_name: 'BBVA México',
  account_name: 'Cuenta Empresarial',
  account_type: 'checking',
  currency: 'MXN',
  last4: '6102',
  current_balance: '25707500.00',  // MX$25,707,500
  balance_currency: 'MXN',
  nickname: 'BBVA MXN Treasury',
  banking_provider: 'belvo',
},
```

Also add BRL/MXN fiat transactions to the seed. Add 4-6 transactions with `fiat_currency: 'BRL'` or `'MXN'`, mixing on-ramp and off-ramp directions.

- [ ] **Step 2: Add BRL/MXN to fiat payments currency pool**

In `src/lib/test-mode/seed/transactions.ts`, update the currency selection to include BRL and MXN:

```typescript
// Replace the currency selection (currently picks from ['USD', 'EUR', 'GBP'])
const currencies = ['USD', 'EUR', 'GBP', 'BRL', 'MXN'];
```

- [ ] **Step 3: Add BRL/MXN vendors and invoices to ERP seed**

In `src/lib/test-mode/seed/erp.ts`, add vendors with BRL/MXN:

```typescript
// Add vendors
{ name: 'TechBR Soluções Ltda', wallet_address: null, chain: null, currency: 'BRL' },
{ name: 'CloudMX Servicios SA', wallet_address: null, chain: null, currency: 'MXN' },
```

Add invoices denominated in BRL and MXN with realistic amounts (e.g., R$45,000, MX$350,000).

- [ ] **Step 4: Commit**

```bash
git add src/lib/test-mode/seed/banking.ts src/lib/test-mode/seed/transactions.ts src/lib/test-mode/seed/erp.ts
git commit -m "feat: add BRL and MXN seed data — bank accounts, transactions, invoices"
```

---

---

## Task 16: Bridge.xyz Real Adapter

**Files:**
- Create: `src/lib/banking/bridge.ts`
- Modify: `src/lib/banking/factory.ts`

- [ ] **Step 1: Create Bridge.xyz adapter**

Create `src/lib/banking/bridge.ts`:

```typescript
import type {
  IBankingAdapter,
  RampQuoteParams, RampQuote, RampExecuteParams, RampResult,
  SwapQuoteParams, SwapQuote, SwapExecuteParams, SwapResult,
  BridgeQuoteParams, BridgeQuote, BridgeExecuteParams, BridgeExecuteResult,
  FiatPaymentParams, FiatPaymentResult, FiatPaymentStatusResult,
} from './interface';
import { getCredential, type IntegrationMode } from '@/lib/env/integration-mode';

const BRIDGE_API_URL = 'https://api.bridge.xyz';

function getApiKey(mode: IntegrationMode): string {
  return getCredential(
    mode,
    process.env.BRIDGE_API_KEY_SANDBOX,
    process.env.BRIDGE_API_KEY_LIVE,
  );
}

async function bridgeFetch(
  mode: IntegrationMode,
  path: string,
  options: RequestInit = {},
): Promise<any> {
  const apiKey = getApiKey(mode);
  const res = await fetch(`${BRIDGE_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Api-Key': apiKey,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bridge API error (${res.status}): ${err}`);
  }

  return res.json();
}

export class BridgeAdapter implements IBankingAdapter {
  constructor(private mode: IntegrationMode) {}

  // ---- Ramps (fiat ↔ crypto) ----

  async getRampQuote(params: RampQuoteParams): Promise<RampQuote> {
    // Bridge Orchestration API: POST /v0/quotes
    const body: Record<string, unknown> = {
      type: params.direction === 'onramp' ? 'buy' : 'sell',
      currency: params.fiatCurrency || 'USD',
      crypto_currency: params.cryptoToken,
    };

    if (params.fiatAmount) body.amount = params.fiatAmount;
    if (params.cryptoAmount) body.crypto_amount = params.cryptoAmount;

    const data = await bridgeFetch(this.mode, '/v0/quotes', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      cryptoAmount: data.crypto_amount ?? data.destination_amount ?? 0,
      fiatAmount: data.fiat_amount ?? data.source_amount ?? 0,
      exchangeRate: data.exchange_rate ?? data.rate ?? 1,
      feeAmount: data.fee ?? data.total_fee ?? 0,
      fiatCurrency: data.currency ?? params.fiatCurrency,
      fxRate: data.fx_rate,
      expiresAt: data.expires_at ?? new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async executeRamp(params: RampExecuteParams): Promise<RampResult> {
    // Bridge Orchestration API: POST /v0/transfers
    const data = await bridgeFetch(this.mode, '/v0/transfers', {
      method: 'POST',
      body: JSON.stringify({
        type: params.direction === 'onramp' ? 'buy' : 'sell',
        currency: params.fiatCurrency,
        crypto_currency: params.cryptoToken,
        amount: params.fiatAmount,
        crypto_amount: params.cryptoAmount,
        source_payment_rail: params.bankAccountRef,
      }),
    });

    return {
      providerTransactionId: data.id ?? data.transfer_id,
      status: data.status ?? 'pending',
      settledAt: data.settled_at ?? null,
    };
  }

  // ---- Swaps (same chain, token → token) ----

  async getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
    const data = await bridgeFetch(this.mode, '/v0/quotes/swap', {
      method: 'POST',
      body: JSON.stringify({
        chain: params.chain,
        from_currency: params.fromToken,
        to_currency: params.toToken,
        amount: params.amount,
        slippage_bps: params.slippageBps ?? 50,
        wallet_address: params.walletAddress,
      }),
    });

    return {
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.amount,
      toAmount: String(data.to_amount ?? data.destination_amount ?? '0'),
      rate: String(data.rate ?? data.exchange_rate ?? '1'),
      slippageBps: data.slippage_bps ?? params.slippageBps ?? 50,
      priceImpact: data.price_impact ? String(data.price_impact) : undefined,
      feeAmount: data.fee ? String(data.fee) : undefined,
      quoteData: { quoteId: data.id, ...data },
    };
  }

  async executeSwap(params: SwapExecuteParams): Promise<SwapResult> {
    const data = await bridgeFetch(this.mode, '/v0/swaps', {
      method: 'POST',
      body: JSON.stringify({
        chain: params.chain,
        from_currency: params.fromToken,
        to_currency: params.toToken,
        amount: params.fromAmount,
        wallet_address: params.walletAddress,
        quote_id: params.quoteData.quoteId,
      }),
    });

    return {
      txHash: data.tx_hash ?? data.transaction_hash ?? null,
      providerRef: data.id ?? data.swap_id,
      status: data.status === 'completed' ? 'completed' : 'pending',
    };
  }

  // ---- Bridges (cross-chain, same token) ----

  async getBridgeQuote(params: BridgeQuoteParams): Promise<BridgeQuote> {
    const data = await bridgeFetch(this.mode, '/v0/quotes/bridge', {
      method: 'POST',
      body: JSON.stringify({
        currency: params.token,
        amount: params.amount,
        source_chain: params.fromChain,
        destination_chain: params.toChain,
        wallet_address: params.walletAddress,
      }),
    });

    return {
      token: params.token,
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromAmount: params.amount,
      toAmount: String(data.destination_amount ?? data.to_amount ?? params.amount),
      bridgeFee: String(data.fee ?? data.bridge_fee ?? '0'),
      estimatedTimeMinutes: data.estimated_time_minutes ?? data.eta_minutes ?? 15,
      provider: 'bridge',
      quoteData: { quoteId: data.id, ...data },
    };
  }

  async executeBridge(params: BridgeExecuteParams): Promise<BridgeExecuteResult> {
    const data = await bridgeFetch(this.mode, '/v0/transfers', {
      method: 'POST',
      body: JSON.stringify({
        type: 'bridge',
        currency: params.token,
        amount: params.amount,
        source_chain: params.fromChain,
        destination_chain: params.toChain,
        wallet_address: params.walletAddress,
        quote_id: params.quoteData.quoteId,
      }),
    });

    return {
      txHash: data.tx_hash ?? data.transaction_hash ?? null,
      providerRef: data.id ?? data.transfer_id,
      status: data.status === 'completed' ? 'completed' : 'pending',
      estimatedArrivalMinutes: data.estimated_time_minutes ?? 15,
    };
  }

  // ---- Fiat Payments (bank-to-bank via Bridge Pay) ----

  async createFiatPayment(params: FiatPaymentParams): Promise<FiatPaymentResult> {
    const data = await bridgeFetch(this.mode, '/v0/payments', {
      method: 'POST',
      body: JSON.stringify({
        source_account: params.fromBankAccountRef,
        destination: {
          bank_name: params.toBankName,
          account_number: params.toAccountNumber,
          routing_number: params.toRoutingNumber,
          account_holder_name: params.toAccountHolder,
        },
        amount: params.amount,
        currency: params.currency,
        memo: params.memo,
      }),
    });

    return {
      providerPaymentId: data.id ?? data.payment_id,
      status: 'pending',
      estimatedSettlement: data.estimated_settlement ?? data.eta ?? new Date(Date.now() + 2 * 86400_000).toISOString(),
    };
  }

  async getFiatPaymentStatus(providerPaymentId: string): Promise<FiatPaymentStatusResult> {
    const data = await bridgeFetch(this.mode, `/v0/payments/${providerPaymentId}`, {
      method: 'GET',
    });

    return {
      status: data.status === 'completed' ? 'completed' : data.status === 'failed' ? 'failed' : 'pending',
      settledAt: data.settled_at ?? null,
    };
  }
}
```

Note: The exact Bridge API endpoint paths and request/response shapes should be verified against Bridge's current API docs at `docs.bridge.xyz`. The adapter uses defensive field access (`data.field ?? data.alternate_field`) to handle potential API shape differences between versions.

- [ ] **Step 2: Update banking factory to use real adapter**

Replace `src/lib/banking/factory.ts`:

```typescript
import type { IBankingAdapter } from './interface';
import { BridgeMockAdapter } from './mock/bridge-mock';
import { BridgeAdapter } from './bridge';
import type { IntegrationMode } from '@/lib/env/integration-mode';

export function getBankingAdapter(mode: IntegrationMode = 'mock'): IBankingAdapter {
  if (mode === 'mock') {
    return new BridgeMockAdapter();
  }

  // Both sandbox and live use the real Bridge adapter with appropriate keys
  return new BridgeAdapter(mode);
}
```

- [ ] **Step 3: Update all API routes that call getBankingAdapter to pass mode**

Find all routes that call `getBankingAdapter()` and update them to pass the integration mode:

```bash
cd C:/Users/John/crypto-treasury && grep -r "getBankingAdapter" src/ --include="*.ts" -l
```

In each route, add:
```typescript
import { getIntegrationMode } from '@/lib/env/integration-mode';

// After session check:
const mode = getIntegrationMode(session.user.subscription_tier);
const adapter = getBankingAdapter(mode);
```

Routes to update:
- `src/app/api/ramps/quote/route.ts`
- `src/app/api/ramps/execute/route.ts`
- `src/app/api/swaps/quote/route.ts`
- `src/app/api/swaps/execute/route.ts`
- `src/app/api/bridges/quote/route.ts`
- `src/app/api/bridges/execute/route.ts`
- `src/app/api/payments/route.ts`
- Any other routes calling `getBankingAdapter()`

- [ ] **Step 4: Commit**

```bash
git add src/lib/banking/bridge.ts src/lib/banking/factory.ts
git add -u  # catch route updates
git commit -m "feat: implement real Bridge.xyz adapter for ramps, swaps, bridges, and fiat payments"
```

---

## Task Summary

| Task | Description | Estimated Scope |
|---|---|---|
| 1 | Database migration + types | Small |
| 2 | Integration mode system | Small |
| 3 | Lite tier gate (API + UI) | Medium |
| 4 | Enterprise country from Persona webhook | Small |
| 5 | Stripe Financial Connections + Plaid removal | Large |
| 6 | Add Compound V3 protocol | Small |
| 7 | Live yield rate fetchers (11 protocols) | Large |
| 8 | Yield rate cron job + API update | Medium |
| 9 | Ondo USDY KYC flow | Medium |
| 10 | UI updates (staleness, Ondo KYC, upgrade gates) | Medium |
| 11 | Stripe FC balance refresh routing | Small |
| 12 | Environment cleanup + build verification | Small |
| 13 | Belvo integration (Brazil/Mexico) | Large |
| 14 | BRL/MXN currency support | Medium |
| 15 | BRL/MXN seed data | Small |
| 16 | Bridge.xyz real adapter | Large |
