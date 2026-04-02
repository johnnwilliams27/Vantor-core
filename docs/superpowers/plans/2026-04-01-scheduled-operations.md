# Scheduled Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduling capabilities to swaps, bridges, and ramps with re-quote-at-execution, tolerance-based auto-execution, manual approval flows, and agent integration.

**Architecture:** A new `scheduled_operations` table stores all scheduled swaps/bridges/ramps. A cron job re-quotes at execution time and auto-executes within tolerance or flags for manual approval. The dashboard's "AI Recommendations" card becomes "AI Approvals" with a shared modal for both recommendations and scheduled operation approvals. Slack gets two-step approval with ephemeral confirmation.

**Tech Stack:** Next.js 14 App Router, Supabase, TanStack Query, Zustand, react-hook-form + Zod, Slack Block Kit

**Spec:** `docs/superpowers/specs/2026-04-01-scheduled-operations-design.md`

---

## File Structure

### New Files
- `supabase/migrations/0020_scheduled_operations.sql` — DB schema
- `src/types/scheduled-operations.ts` — TypeScript types
- `src/lib/scheduled-operations/executor.ts` — Re-quote + execute/flag logic
- `src/lib/scheduled-operations/tolerances.ts` — Tolerance constants + deviation calc
- `src/app/api/scheduled-operations/route.ts` — GET + POST
- `src/app/api/scheduled-operations/[id]/route.ts` — GET + DELETE
- `src/app/api/scheduled-operations/[id]/approve/route.ts` — POST approve
- `src/app/api/cron/process-scheduled-operations/route.ts` — Cron job
- `src/hooks/useScheduledOperations.ts` — TanStack Query hooks
- `src/components/scheduled/ScheduleSwapForm.tsx` — Schedule swap form
- `src/components/scheduled/ScheduleBridgeForm.tsx` — Schedule bridge form
- `src/components/scheduled/ScheduleRampForm.tsx` — Schedule ramp form
- `src/components/scheduled/ApprovalModal.tsx` — Shared approval modal

### Modified Files
- `src/types/database.ts` — Add audit actions
- `src/lib/agent/tools.ts` — Add 6 new agent tools
- `src/lib/agent/context.ts` — Update system prompt
- `src/lib/integrations/slack.ts` — Add scheduled operation Slack messages
- `src/app/api/integrations/slack/callback/route.ts` — Handle scheduled op callbacks
- `src/components/charts/RecommendationsCard.tsx` — Rename to AI Approvals, add modal, include scheduled ops
- `src/components/notifications/NotificationsPanel.tsx` — Add scheduled op notification dots
- `src/app/(app)/swaps/page.tsx` — Add ScheduleSwapForm
- `src/app/(app)/bridges/page.tsx` — Add ScheduleBridgeForm, convert to client component
- `src/app/(app)/ramps/page.tsx` — Add ScheduleRampForm
- `vercel.json` — Add cron entry

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/0020_scheduled_operations.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Scheduled operations for swaps, bridges, and ramps
CREATE TABLE scheduled_operations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  enterprise_id     UUID REFERENCES enterprises(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('swap', 'bridge', 'ramp')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'awaiting_authorization', 'completed', 'failed', 'cancelled', 'expired')),
  scheduled_for     TIMESTAMPTZ NOT NULL,
  params            JSONB NOT NULL,
  initial_quote     JSONB NOT NULL,
  execution_quote   JSONB,
  deviation_bps     INTEGER,
  tolerance_bps     INTEGER NOT NULL,
  executed_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  tx_hash           TEXT,
  error_message     TEXT,
  memo              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_ops_pending
  ON scheduled_operations(status, scheduled_for)
  WHERE status = 'pending' AND scheduled_for IS NOT NULL;

CREATE INDEX idx_scheduled_ops_expiring
  ON scheduled_operations(status, expires_at)
  WHERE status = 'awaiting_authorization' AND expires_at IS NOT NULL;

CREATE INDEX idx_scheduled_ops_user
  ON scheduled_operations(user_id, enterprise_id);

-- Add scheduled_operation_id + metadata to transaction tables
ALTER TABLE swaps
  ADD COLUMN IF NOT EXISTS scheduled_operation_id UUID REFERENCES scheduled_operations(id),
  ADD COLUMN IF NOT EXISTS scheduled_metadata JSONB;

ALTER TABLE bridge_transfers
  ADD COLUMN IF NOT EXISTS scheduled_operation_id UUID REFERENCES scheduled_operations(id),
  ADD COLUMN IF NOT EXISTS scheduled_metadata JSONB;

ALTER TABLE fiat_transactions
  ADD COLUMN IF NOT EXISTS scheduled_operation_id UUID REFERENCES scheduled_operations(id),
  ADD COLUMN IF NOT EXISTS scheduled_metadata JSONB;

-- RLS policies
ALTER TABLE scheduled_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scheduled operations"
  ON scheduled_operations FOR SELECT
  USING (user_id = auth.uid() OR enterprise_id IN (
    SELECT enterprise_id FROM user_profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert own scheduled operations"
  ON scheduled_operations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own scheduled operations"
  ON scheduled_operations FOR UPDATE
  USING (user_id = auth.uid());

-- Updated_at trigger
CREATE TRIGGER set_scheduled_operations_updated_at
  BEFORE UPDATE ON scheduled_operations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

- [ ] **Step 2: Run the migration in Supabase SQL editor**

Copy the contents of `0020_scheduled_operations.sql` and run in the Supabase SQL editor for both dev and production projects.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0020_scheduled_operations.sql
git commit -m "feat: add scheduled_operations table and transaction table columns"
```

---

## Task 2: TypeScript Types & Tolerance Constants

**Files:**
- Create: `src/types/scheduled-operations.ts`
- Create: `src/lib/scheduled-operations/tolerances.ts`
- Modify: `src/types/database.ts:21-43`

- [ ] **Step 1: Create the types file**

Create `src/types/scheduled-operations.ts`:

```typescript
import type { ChainType, TokenSymbol } from './database';

export type ScheduledOperationType = 'swap' | 'bridge' | 'ramp';

export type ScheduledOperationStatus =
  | 'pending'
  | 'processing'
  | 'awaiting_authorization'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ScheduledOperation {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  type: ScheduledOperationType;
  status: ScheduledOperationStatus;
  scheduled_for: string;
  params: SwapParams | BridgeParams | RampParams;
  initial_quote: Record<string, unknown>;
  execution_quote: Record<string, unknown> | null;
  deviation_bps: number | null;
  tolerance_bps: number;
  executed_at: string | null;
  expires_at: string | null;
  tx_hash: string | null;
  error_message: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface SwapParams {
  walletId: string;
  chain: ChainType;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  amount: string;
  slippageBps?: number;
  walletAddress: string;
}

export interface BridgeParams {
  fromWalletId: string;
  toWalletId: string;
  token: TokenSymbol;
  amount: string;
  fromChain: ChainType;
  toChain: ChainType;
  walletAddress: string;
}

export interface RampParams {
  direction: 'onramp' | 'offramp';
  cryptoToken: TokenSymbol;
  fiatCurrency: string;
  cryptoAmount: number;
  fiatAmount?: number;
  bankAccountId: string;
  walletId?: string;
}

export interface ScheduledMetadata {
  original_rate: string;
  executed_rate: string;
  deviation_bps: number;
  scheduled_for: string;
}
```

- [ ] **Step 2: Create the tolerances file**

Create `src/lib/scheduled-operations/tolerances.ts`:

```typescript
import type { ScheduledOperationType } from '@/types/scheduled-operations';

/** Maximum allowed deviation in basis points per operation type */
export const TOLERANCE_BPS: Record<ScheduledOperationType, number> = {
  swap: 10,
  bridge: 25,
  ramp: 50,
};

/** Calculate deviation between two rates in basis points */
export function calculateDeviationBps(originalRate: number, newRate: number): number {
  if (originalRate === 0) return 0;
  return Math.round(Math.abs((newRate - originalRate) / originalRate) * 10_000);
}

/** Extract the comparable rate from a quote object by operation type */
export function extractRate(type: ScheduledOperationType, quote: Record<string, unknown>): number {
  switch (type) {
    case 'swap':
      return parseFloat((quote.rate as string) ?? '0');
    case 'bridge': {
      const from = parseFloat((quote.fromAmount as string) ?? '0');
      const to = parseFloat((quote.toAmount as string) ?? '0');
      return from > 0 ? to / from : 0;
    }
    case 'ramp':
      return (quote.exchangeRate as number) ?? 0;
    default:
      return 0;
  }
}
```

- [ ] **Step 3: Add audit actions to database.ts**

In `src/types/database.ts`, add scheduled operation audit actions after line 43 (after `'yield_deposit' | 'yield_withdraw' | 'yield_position_refresh'`):

Add these to the `AuditAction` union:
```typescript
  | 'scheduled_operation_create' | 'scheduled_operation_approve'
  | 'scheduled_operation_cancel' | 'scheduled_operation_expire'
  | 'scheduled_operation_execute' | 'scheduled_operation_deviation'
  | 'bridge_execute'
```

Note: `bridge_execute` is already used in the bridge execute route (cast as `any`), so adding it to the type legitimizes it.

- [ ] **Step 4: Commit**

```bash
git add src/types/scheduled-operations.ts src/lib/scheduled-operations/tolerances.ts src/types/database.ts
git commit -m "feat: add scheduled operation types, tolerances, and audit actions"
```

---

## Task 3: Scheduled Operations Executor

**Files:**
- Create: `src/lib/scheduled-operations/executor.ts`

- [ ] **Step 1: Create the executor**

Create `src/lib/scheduled-operations/executor.ts`:

```typescript
import { createAdminClient } from '@/lib/supabase/admin';
import { getBankingAdapter } from '@/lib/banking/factory';
import { writeAuditLog } from '@/lib/audit/logger';
import { updateBalancesAfterSwap, updateWalletBalance, updateBalancesAfterRamp } from '@/lib/balances/update-after-movement';
import { isTestMode } from '@/lib/test-mode/helpers';
import { recordUsageFee } from '@/lib/billing/usage';
import { calculateDeviationBps, extractRate } from './tolerances';
import type { ScheduledOperation, SwapParams, BridgeParams, RampParams } from '@/types/scheduled-operations';

interface ExecutionResult {
  executed: boolean;
  flagged: boolean;
  error?: string;
}

export async function executeScheduledOperation(op: ScheduledOperation): Promise<ExecutionResult> {
  const supabase = createAdminClient();
  const adapter = getBankingAdapter();

  // Mark as processing
  await supabase
    .from('scheduled_operations')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', op.id);

  try {
    // Re-quote based on type
    const freshQuote = await getQuote(op, adapter);
    const originalRate = extractRate(op.type, op.initial_quote);
    const newRate = extractRate(op.type, freshQuote as Record<string, unknown>);
    const deviation = calculateDeviationBps(originalRate, newRate);

    // Store execution quote and deviation
    await supabase
      .from('scheduled_operations')
      .update({
        execution_quote: freshQuote as Record<string, unknown>,
        deviation_bps: deviation,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    // Check tolerance
    if (deviation > op.tolerance_bps) {
      // Flag for manual approval
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from('scheduled_operations')
        .update({
          status: 'awaiting_authorization',
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', op.id);

      await writeAuditLog({
        userId: op.user_id,
        action: 'scheduled_operation_deviation' as any,
        entityType: 'scheduled_operation',
        entityId: op.id,
        details: { type: op.type, deviation, tolerance: op.tolerance_bps, originalRate, newRate },
      });

      return { executed: false, flagged: true };
    }

    // Within tolerance — execute
    const result = await performExecution(op, freshQuote, supabase);

    // Update scheduled operation
    await supabase
      .from('scheduled_operations')
      .update({
        status: 'completed',
        executed_at: new Date().toISOString(),
        tx_hash: result.txHash ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    await writeAuditLog({
      userId: op.user_id,
      action: 'scheduled_operation_execute' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: { type: op.type, deviation, txHash: result.txHash },
    });

    return { executed: true, flagged: false };
  } catch (err) {
    const message = (err as Error).message;
    await supabase
      .from('scheduled_operations')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    return { executed: false, flagged: false, error: message };
  }
}

async function getQuote(op: ScheduledOperation, adapter: ReturnType<typeof getBankingAdapter>) {
  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      return adapter.getSwapQuote({
        chain: p.chain,
        fromToken: p.fromToken,
        toToken: p.toToken,
        amount: p.amount,
        slippageBps: p.slippageBps,
        walletAddress: p.walletAddress,
      });
    }
    case 'bridge': {
      const p = op.params as BridgeParams;
      return adapter.getBridgeQuote({
        token: p.token,
        amount: p.amount,
        fromChain: p.fromChain,
        toChain: p.toChain,
        walletAddress: p.walletAddress,
      });
    }
    case 'ramp': {
      const p = op.params as RampParams;
      return adapter.getRampQuote({
        direction: p.direction,
        cryptoToken: p.cryptoToken,
        fiatCurrency: p.fiatCurrency,
        cryptoAmount: p.cryptoAmount,
        fiatAmount: p.fiatAmount,
      });
    }
  }
}

async function performExecution(
  op: ScheduledOperation,
  quote: any,
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ txHash: string | null; recordId: string }> {
  const adapter = getBankingAdapter();
  const originalRate = extractRate(op.type, op.initial_quote);
  const executedRate = extractRate(op.type, quote as Record<string, unknown>);
  const deviation = calculateDeviationBps(originalRate, executedRate);

  const scheduledMeta = {
    original_rate: String(originalRate),
    executed_rate: String(executedRate),
    deviation_bps: deviation,
    scheduled_for: op.scheduled_for,
  };

  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      const result = await adapter.executeSwap({
        chain: p.chain,
        fromToken: p.fromToken,
        toToken: p.toToken,
        fromAmount: quote.fromAmount,
        toAmount: quote.toAmount,
        walletAddress: p.walletAddress,
        quoteData: quote.quoteData,
      });

      const { data: swap } = await supabase
        .from('swaps')
        .insert({
          user_id: op.user_id,
          enterprise_id: op.enterprise_id,
          wallet_id: p.walletId,
          chain: p.chain,
          from_token: p.fromToken,
          to_token: p.toToken,
          from_amount: quote.fromAmount,
          to_amount: quote.toAmount,
          tx_hash: result.txHash,
          status: result.txHash ? 'completed' : 'pending',
          quote_data: quote.quoteData,
          executed_at: new Date().toISOString(),
          scheduled_operation_id: op.id,
          scheduled_metadata: scheduledMeta,
        })
        .select()
        .single();

      await updateBalancesAfterSwap({
        walletId: p.walletId,
        fromToken: p.fromToken,
        toToken: p.toToken,
        fromAmount: parseFloat(quote.fromAmount),
        toAmount: parseFloat(quote.toAmount),
      });

      if (!isTestMode() && op.enterprise_id) {
        await recordUsageFee({
          enterpriseId: op.enterprise_id,
          transactionType: 'swap',
          transactionId: swap?.id ?? op.id,
          notionalAmountUsd: parseFloat(quote.fromAmount),
        });
      }

      return { txHash: result.txHash, recordId: swap?.id ?? op.id };
    }
    case 'bridge': {
      const p = op.params as BridgeParams;

      // Get wallet addresses
      const { data: fromWallet } = await supabase
        .from('wallets')
        .select('address')
        .eq('id', p.fromWalletId)
        .single();

      const result = await adapter.executeBridge({
        token: p.token,
        amount: p.amount,
        fromChain: p.fromChain,
        toChain: p.toChain,
        walletAddress: fromWallet?.address ?? p.walletAddress,
        quoteData: quote.quoteData,
      });

      const bridgeFee = parseFloat(quote.bridgeFee ?? '0');
      const receivedAmount = (parseFloat(p.amount) - bridgeFee).toFixed(6);

      const { data: bridge } = await supabase
        .from('bridge_transfers')
        .insert({
          user_id: op.user_id,
          enterprise_id: op.enterprise_id,
          from_wallet_id: p.fromWalletId,
          to_wallet_id: p.toWalletId,
          token: p.token,
          amount: parseFloat(p.amount),
          received_amount: parseFloat(receivedAmount),
          bridge_fee: bridgeFee,
          from_chain: p.fromChain,
          to_chain: p.toChain,
          provider: 'bridge',
          tx_hash: result.txHash,
          status: result.status === 'completed' ? 'completed' : 'pending',
          estimated_arrival_minutes: result.estimatedArrivalMinutes,
          metadata: quote.quoteData,
          executed_at: new Date().toISOString(),
          scheduled_operation_id: op.id,
          scheduled_metadata: scheduledMeta,
        })
        .select()
        .single();

      await updateWalletBalance({ walletId: p.fromWalletId, token: p.token, delta: -parseFloat(p.amount) });
      await updateWalletBalance({ walletId: p.toWalletId, token: p.token, delta: parseFloat(receivedAmount) });

      if (!isTestMode() && op.enterprise_id) {
        await recordUsageFee({
          enterpriseId: op.enterprise_id,
          transactionType: 'bridge',
          transactionId: bridge?.id ?? op.id,
          notionalAmountUsd: parseFloat(p.amount),
        });
      }

      return { txHash: result.txHash, recordId: bridge?.id ?? op.id };
    }
    case 'ramp': {
      const p = op.params as RampParams;

      // Get bank account ref
      const { data: bankAccount } = await supabase
        .from('bank_accounts')
        .select('id, plaid_account_id')
        .eq('id', p.bankAccountId)
        .single();

      const result = await adapter.executeRamp({
        direction: p.direction,
        cryptoToken: p.cryptoToken,
        cryptoAmount: quote.cryptoAmount,
        fiatAmount: quote.fiatAmount,
        fiatCurrency: p.fiatCurrency,
        exchangeRate: quote.exchangeRate,
        feeAmount: quote.feeAmount,
        bankAccountRef: bankAccount?.plaid_account_id ?? bankAccount?.id ?? p.bankAccountId,
      });

      const { data: fiatTx } = await supabase
        .from('fiat_transactions')
        .insert({
          user_id: op.user_id,
          enterprise_id: op.enterprise_id,
          bank_account_id: p.bankAccountId,
          direction: p.direction,
          crypto_amount: quote.cryptoAmount,
          crypto_token: p.cryptoToken,
          fiat_amount: quote.fiatAmount,
          fiat_currency: p.fiatCurrency,
          exchange_rate: quote.exchangeRate,
          fee_amount: quote.feeAmount,
          status: result.status,
          provider: 'bridge',
          provider_transaction_id: result.providerTransactionId,
          settled_at: result.settledAt,
          scheduled_operation_id: op.id,
          scheduled_metadata: scheduledMeta,
        })
        .select()
        .single();

      // Find user wallet for balance update
      const { data: userWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', op.user_id)
        .eq('enterprise_id', op.enterprise_id)
        .limit(1)
        .maybeSingle();

      await updateBalancesAfterRamp({
        direction: p.direction,
        walletId: userWallet?.id ?? p.walletId,
        bankAccountId: p.bankAccountId,
        token: p.cryptoToken,
        cryptoAmount: quote.cryptoAmount,
        fiatAmount: quote.fiatAmount,
      });

      if (!isTestMode() && op.enterprise_id) {
        await recordUsageFee({
          enterpriseId: op.enterprise_id,
          transactionType: 'ramp',
          transactionId: fiatTx?.id ?? op.id,
          notionalAmountUsd: quote.fiatAmount,
        });
      }

      return { txHash: null, recordId: fiatTx?.id ?? op.id };
    }
  }
}

/** Approve and execute a flagged operation at current market rate */
export async function approveAndExecute(op: ScheduledOperation): Promise<{ txHash: string | null; error?: string }> {
  const supabase = createAdminClient();
  const adapter = getBankingAdapter();

  try {
    const freshQuote = await getQuote(op, adapter);

    await supabase
      .from('scheduled_operations')
      .update({
        status: 'processing',
        execution_quote: freshQuote as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    const result = await performExecution(op, freshQuote, supabase);

    await supabase
      .from('scheduled_operations')
      .update({
        status: 'completed',
        executed_at: new Date().toISOString(),
        tx_hash: result.txHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    await writeAuditLog({
      userId: op.user_id,
      action: 'scheduled_operation_approve' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: { type: op.type, txHash: result.txHash },
    });

    return { txHash: result.txHash };
  } catch (err) {
    const message = (err as Error).message;
    await supabase
      .from('scheduled_operations')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', op.id);

    return { txHash: null, error: message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/scheduled-operations/executor.ts
git commit -m "feat: add scheduled operation executor with re-quote and tolerance checking"
```

---

## Task 4: API Routes

**Files:**
- Create: `src/app/api/scheduled-operations/route.ts`
- Create: `src/app/api/scheduled-operations/[id]/route.ts`
- Create: `src/app/api/scheduled-operations/[id]/approve/route.ts`

- [ ] **Step 1: Create GET + POST route**

Create `src/app/api/scheduled-operations/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getBankingAdapter } from '@/lib/banking/factory';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { TOLERANCE_BPS } from '@/lib/scheduled-operations/tolerances';
import { z } from 'zod';
import type { ScheduledOperationType } from '@/types/scheduled-operations';

const swapParamsSchema = z.object({
  walletId: z.string().uuid(),
  chain: z.enum(['ethereum', 'solana']),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Must be positive'),
  slippageBps: z.number().optional(),
  walletAddress: z.string().min(10),
});

const bridgeParamsSchema = z.object({
  fromWalletId: z.string().uuid(),
  toWalletId: z.string().uuid(),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Must be positive'),
  fromChain: z.enum(['ethereum', 'solana']),
  toChain: z.enum(['ethereum', 'solana']),
  walletAddress: z.string().min(10),
}).refine((d) => d.fromChain !== d.toChain, { message: 'Chains must differ', path: ['toChain'] });

const rampParamsSchema = z.object({
  direction: z.enum(['onramp', 'offramp']),
  cryptoToken: z.enum(['USDC', 'USDT']),
  fiatCurrency: z.string().default('USD'),
  cryptoAmount: z.number().positive(),
  fiatAmount: z.number().optional(),
  bankAccountId: z.string().uuid(),
  walletId: z.string().uuid().optional(),
});

const createSchema = z.object({
  type: z.enum(['swap', 'bridge', 'ramp']),
  scheduledFor: z.string().datetime(),
  memo: z.string().max(2000).optional(),
  params: z.record(z.unknown()),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'accountant'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const supabase = createAdminClient();
  const type = req.nextUrl.searchParams.get('type');
  const status = req.nextUrl.searchParams.get('status');

  let query = supabase
    .from('scheduled_operations')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (type) query = query.eq('type', type);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { type, scheduledFor, memo, params } = parsed.data;

  // Validate type-specific params
  let validatedParams: Record<string, unknown>;
  switch (type) {
    case 'swap': {
      const result = swapParamsSchema.safeParse(params);
      if (!result.success) return NextResponse.json({ error: 'Invalid swap params', details: result.error.flatten() }, { status: 400 });
      validatedParams = result.data;
      break;
    }
    case 'bridge': {
      const result = bridgeParamsSchema.safeParse(params);
      if (!result.success) return NextResponse.json({ error: 'Invalid bridge params', details: result.error.flatten() }, { status: 400 });
      validatedParams = result.data;
      break;
    }
    case 'ramp': {
      const result = rampParamsSchema.safeParse(params);
      if (!result.success) return NextResponse.json({ error: 'Invalid ramp params', details: result.error.flatten() }, { status: 400 });
      validatedParams = result.data;
      break;
    }
  }

  // Fetch initial quote
  const adapter = getBankingAdapter();
  let initialQuote: Record<string, unknown>;

  try {
    switch (type) {
      case 'swap': {
        const p = validatedParams as z.infer<typeof swapParamsSchema>;
        const q = await adapter.getSwapQuote({ chain: p.chain, fromToken: p.fromToken, toToken: p.toToken, amount: p.amount, walletAddress: p.walletAddress, slippageBps: p.slippageBps });
        initialQuote = q as unknown as Record<string, unknown>;
        break;
      }
      case 'bridge': {
        const p = validatedParams as z.infer<typeof bridgeParamsSchema>;
        const q = await adapter.getBridgeQuote({ token: p.token, amount: p.amount, fromChain: p.fromChain, toChain: p.toChain, walletAddress: p.walletAddress });
        initialQuote = q as unknown as Record<string, unknown>;
        break;
      }
      case 'ramp': {
        const p = validatedParams as z.infer<typeof rampParamsSchema>;
        const q = await adapter.getRampQuote({ direction: p.direction, cryptoToken: p.cryptoToken, fiatCurrency: p.fiatCurrency, cryptoAmount: p.cryptoAmount, fiatAmount: p.fiatAmount });
        initialQuote = q as unknown as Record<string, unknown>;
        break;
      }
    }
  } catch (err) {
    return NextResponse.json({ error: `Failed to get quote: ${(err as Error).message}` }, { status: 502 });
  }

  const toleranceBps = TOLERANCE_BPS[type as ScheduledOperationType];
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('scheduled_operations')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      type,
      scheduled_for: scheduledFor,
      params: validatedParams,
      initial_quote: initialQuote!,
      tolerance_bps: toleranceBps,
      memo: memo ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAuditLog({
    userId: session.user.id,
    action: 'scheduled_operation_create' as any,
    entityType: 'scheduled_operation',
    entityId: data.id,
    details: { type, scheduledFor, toleranceBps },
  });

  return NextResponse.json({ data, initialQuote: initialQuote!, toleranceBps }, { status: 201 });
}
```

- [ ] **Step 2: Create GET + DELETE [id] route**

Create `src/app/api/scheduled-operations/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('scheduled_operations')
    .select('*')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: op } = await supabase
    .from('scheduled_operations')
    .select('id, status, type')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (op.status !== 'pending' && op.status !== 'awaiting_authorization') {
    return NextResponse.json({ error: `Cannot cancel operation with status '${op.status}'` }, { status: 400 });
  }

  await supabase
    .from('scheduled_operations')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  await writeAuditLog({
    userId: session.user.id,
    action: 'scheduled_operation_cancel' as any,
    entityType: 'scheduled_operation',
    entityId: params.id,
    details: { type: op.type },
  });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Create approve route**

Create `src/app/api/scheduled-operations/[id]/approve/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { approveAndExecute } from '@/lib/scheduled-operations/executor';
import type { ScheduledOperation } from '@/types/scheduled-operations';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);
  if (!enterpriseId) return NextResponse.json({ error: 'No enterprise' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: op } = await supabase
    .from('scheduled_operations')
    .select('*')
    .eq('id', params.id)
    .eq('enterprise_id', enterpriseId)
    .single();

  if (!op) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (op.status !== 'awaiting_authorization') {
    return NextResponse.json({ error: `Cannot approve operation with status '${op.status}'` }, { status: 400 });
  }

  // Check expiry
  if (op.expires_at && new Date(op.expires_at) < new Date()) {
    await supabase
      .from('scheduled_operations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', params.id);
    return NextResponse.json({ error: 'Operation has expired' }, { status: 410 });
  }

  const result = await approveAndExecute(op as unknown as ScheduledOperation);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true, txHash: result.txHash });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/scheduled-operations/
git commit -m "feat: add scheduled operations API routes (CRUD + approve)"
```

---

## Task 5: Cron Job

**Files:**
- Create: `src/app/api/cron/process-scheduled-operations/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron route**

Create `src/app/api/cron/process-scheduled-operations/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { executeScheduledOperation } from '@/lib/scheduled-operations/executor';
import { writeAuditLog } from '@/lib/audit/logger';
import { notifyScheduledOperationDeviation, notifyScheduledOperationExpiry } from '@/lib/integrations/slack';
import type { ScheduledOperation } from '@/types/scheduled-operations';

const BATCH_SIZE = 50;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get test enterprise IDs to exclude
  const { data: testEnts } = await supabase
    .from('enterprises')
    .select('id')
    .eq('is_test_enterprise', true);
  const testEntIds = (testEnts ?? []).map((e) => e.id);

  // 1. Process pending operations that are due
  let pendingQuery = supabase
    .from('scheduled_operations')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(BATCH_SIZE);

  if (testEntIds.length > 0) {
    pendingQuery = pendingQuery.not('enterprise_id', 'in', `(${testEntIds.join(',')})`);
  }

  const { data: pendingOps, error: pendingError } = await pendingQuery;
  if (pendingError) {
    console.error('[cron/scheduled-ops] pending query error:', pendingError);
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  let executed = 0;
  let flagged = 0;
  let failed = 0;

  for (const op of (pendingOps ?? []) as unknown as ScheduledOperation[]) {
    const result = await executeScheduledOperation(op);
    if (result.executed) executed++;
    else if (result.flagged) {
      flagged++;
      // Notify via Slack if connected
      await notifyDeviationSafe(supabase, op);
    }
    else failed++;
  }

  // 2. Expire stale awaiting_authorization operations
  const { data: expiredOps } = await supabase
    .from('scheduled_operations')
    .select('*')
    .eq('status', 'awaiting_authorization')
    .lte('expires_at', new Date().toISOString());

  let expired = 0;
  for (const op of (expiredOps ?? []) as unknown as ScheduledOperation[]) {
    await supabase
      .from('scheduled_operations')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', op.id);

    await writeAuditLog({
      userId: op.user_id,
      action: 'scheduled_operation_expire' as any,
      entityType: 'scheduled_operation',
      entityId: op.id,
      details: { type: op.type },
    });

    // Notify via Slack if connected
    await notifyExpirySafe(supabase, op);
    expired++;
  }

  console.log(`[cron/scheduled-ops] executed=${executed} flagged=${flagged} failed=${failed} expired=${expired}`);
  return NextResponse.json({ executed, flagged, failed, expired });
}

async function notifyDeviationSafe(supabase: ReturnType<typeof createAdminClient>, op: ScheduledOperation) {
  try {
    const { data: slack } = await supabase
      .from('slack_integrations')
      .select('credentials, channel_id')
      .eq('enterprise_id', op.enterprise_id)
      .eq('is_active', true)
      .maybeSingle();

    if (slack) {
      const { decryptSlackCredentials } = await import('@/lib/integrations/slack');
      const creds = decryptSlackCredentials(slack.credentials);
      await notifyScheduledOperationDeviation(creds.bot_token, slack.channel_id, op);
    }
  } catch {
    // Non-blocking — Slack notification failure should not affect cron
  }
}

async function notifyExpirySafe(supabase: ReturnType<typeof createAdminClient>, op: ScheduledOperation) {
  try {
    const { data: slack } = await supabase
      .from('slack_integrations')
      .select('credentials, channel_id')
      .eq('enterprise_id', op.enterprise_id)
      .eq('is_active', true)
      .maybeSingle();

    if (slack) {
      const { decryptSlackCredentials } = await import('@/lib/integrations/slack');
      const creds = decryptSlackCredentials(slack.credentials);
      await notifyScheduledOperationExpiry(creds.bot_token, slack.channel_id, op);
    }
  } catch {
    // Non-blocking
  }
}
```

- [ ] **Step 2: Add cron to vercel.json**

In `vercel.json`, add to the `crons` array:

```json
{
  "path": "/api/cron/process-scheduled-operations",
  "schedule": "*/5 * * * *"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/process-scheduled-operations/route.ts vercel.json
git commit -m "feat: add scheduled operations cron job (5-minute interval)"
```

---

## Task 6: Slack Integration for Scheduled Operations

**Files:**
- Modify: `src/lib/integrations/slack.ts`
- Modify: `src/app/api/integrations/slack/callback/route.ts`

- [ ] **Step 1: Add Slack notification functions**

Add these functions to the end of `src/lib/integrations/slack.ts` (before the closing of the file):

```typescript
export async function notifyScheduledOperationDeviation(
  botToken: string,
  channelId: string,
  op: {
    id: string;
    type: string;
    tolerance_bps: number;
    deviation_bps: number | null;
    initial_quote: Record<string, unknown>;
    execution_quote: Record<string, unknown> | null;
    params: Record<string, unknown>;
  }
): Promise<{ ts: string; channel: string } | null> {
  const typeLabel = op.type.charAt(0).toUpperCase() + op.type.slice(1);
  const deviation = op.deviation_bps ?? 0;

  await ensureChannelJoined(botToken, channelId);

  const result = await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `⚠️ Scheduled ${typeLabel} — Approval Required`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Type:*\n${typeLabel}` },
          { type: 'mrkdwn', text: `*Deviation:*\n${deviation} bps (limit: ${op.tolerance_bps} bps)` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `This scheduled ${op.type} exceeded the ${op.tolerance_bps}bps auto-execution tolerance. Manual authorization is required within 24 hours.` },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Review & Approve', emoji: true },
            style: 'primary',
            action_id: 'scheduled_op_approve_review',
            value: op.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Deny', emoji: true },
            style: 'danger',
            action_id: 'scheduled_op_deny',
            value: op.id,
          },
        ],
      },
    ],
    text: `Scheduled ${typeLabel} exceeded tolerance (${deviation}bps > ${op.tolerance_bps}bps) — approval required`,
  });

  if (!result.ok) return null;
  return { ts: result.ts ?? '', channel: result.channel ?? channelId };
}

export async function notifyScheduledOperationExpiry(
  botToken: string,
  channelId: string,
  op: { id: string; type: string }
): Promise<void> {
  const typeLabel = op.type.charAt(0).toUpperCase() + op.type.slice(1);
  await slackPost(botToken, 'chat.postMessage', {
    channel: channelId,
    text: `⏰ Scheduled ${typeLabel} (${op.id.slice(0, 8)}…) expired — no action taken within 24 hours.`,
  });
}

export async function postScheduledOpConfirmation(
  botToken: string,
  channelId: string,
  op: { id: string; type: string },
  status: 'executed' | 'cancelled'
): Promise<void> {
  const typeLabel = op.type.charAt(0).toUpperCase() + op.type.slice(1);
  const msg = status === 'executed'
    ? `✅ Scheduled ${typeLabel} (${op.id.slice(0, 8)}…) has been executed.`
    : `❌ Scheduled ${typeLabel} (${op.id.slice(0, 8)}…) has been cancelled.`;
  await slackPost(botToken, 'chat.postMessage', { channel: channelId, text: msg });
}
```

- [ ] **Step 2: Add callback handlers for scheduled operations**

In `src/app/api/integrations/slack/callback/route.ts`, add handling for `scheduled_op_approve_review` and `scheduled_op_deny` action IDs in the existing action handler switch/if block. The handler should:

For `scheduled_op_approve_review`:
1. Fetch the scheduled operation from the DB
2. Fetch a fresh quote
3. Post an ephemeral message via `postEphemeralConfirmation` showing the current rate vs original
4. Include a "Confirm Execute" button (`scheduled_op_confirm_execute`) and "Cancel" button

For `scheduled_op_confirm_execute`:
1. Call `approveAndExecute` from the executor
2. Post a channel message with the result via `postScheduledOpConfirmation`

For `scheduled_op_deny`:
1. Update status to `cancelled`
2. Post a channel message confirming cancellation

- [ ] **Step 3: Commit**

```bash
git add src/lib/integrations/slack.ts src/app/api/integrations/slack/callback/route.ts
git commit -m "feat: add Slack notifications and two-step approval for scheduled operations"
```

---

## Task 7: TanStack Query Hooks

**Files:**
- Create: `src/hooks/useScheduledOperations.ts`

- [ ] **Step 1: Create the hooks file**

Create `src/hooks/useScheduledOperations.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ScheduledOperation, ScheduledOperationType } from '@/types/scheduled-operations';

export function useScheduledOperations(filters?: { type?: ScheduledOperationType; status?: string }) {
  return useQuery<ScheduledOperation[]>({
    queryKey: ['scheduled-operations', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.type) params.set('type', filters.type);
      if (filters?.status) params.set('status', filters.status);
      const res = await fetch(`/api/scheduled-operations?${params}`);
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 15_000,
  });
}

export function usePendingApprovals() {
  return useQuery<ScheduledOperation[]>({
    queryKey: ['scheduled-operations', { status: 'awaiting_authorization' }],
    queryFn: async () => {
      const res = await fetch('/api/scheduled-operations?status=awaiting_authorization');
      if (!res.ok) return [];
      const { data } = await res.json();
      return data ?? [];
    },
    staleTime: 15_000,
  });
}

export function useScheduledOperationQuote(id: string) {
  return useQuery<{ data: ScheduledOperation; freshQuote: Record<string, unknown> }>({
    queryKey: ['scheduled-operation', id],
    queryFn: async () => {
      const res = await fetch(`/api/scheduled-operations/${id}`);
      if (!res.ok) throw new Error('Failed to fetch operation');
      return res.json();
    },
    enabled: !!id,
  });
}

export function useApproveScheduledOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled-operations/${id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Approval failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-operations'] });
    },
  });
}

export function useCancelScheduledOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/scheduled-operations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Cancellation failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-operations'] });
    },
  });
}

export function useCreateScheduledOperation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      type: ScheduledOperationType;
      scheduledFor: string;
      memo?: string;
      params: Record<string, unknown>;
    }) => {
      const res = await fetch('/api/scheduled-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? 'Failed to schedule');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-operations'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useScheduledOperations.ts
git commit -m "feat: add TanStack Query hooks for scheduled operations"
```

---

## Task 8: Scheduling Forms (Swap, Bridge, Ramp)

**Files:**
- Create: `src/components/scheduled/ScheduleSwapForm.tsx`
- Create: `src/components/scheduled/ScheduleBridgeForm.tsx`
- Create: `src/components/scheduled/ScheduleRampForm.tsx`
- Modify: `src/app/(app)/swaps/page.tsx`
- Modify: `src/app/(app)/bridges/page.tsx`
- Modify: `src/app/(app)/ramps/page.tsx`

- [ ] **Step 1: Create ScheduleSwapForm**

Create `src/components/scheduled/ScheduleSwapForm.tsx`. Follow the same structure as `src/components/payments/SchedulePaymentForm.tsx`:

```typescript
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useWallets } from '@/hooks/useWallets';
import { useWalletTokenBalance } from '@/hooks/useBalances';
import { BalanceHint } from '@/components/ui/balance-hint';
import { useCreateScheduledOperation } from '@/hooks/useScheduledOperations';
import { TOLERANCE_BPS } from '@/lib/scheduled-operations/tolerances';
import { Loader2, Calendar } from 'lucide-react';

const schema = z.object({
  walletId: z.string().uuid('Select a wallet'),
  fromToken: z.enum(['USDC', 'USDT']),
  toToken: z.enum(['USDC', 'USDT']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Enter a valid amount'),
  scheduledFor: z.string().min(1, 'Select a date/time'),
  memo: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export function ScheduleSwapForm() {
  const { data: wallets } = useWallets();
  const { toast } = useToast();
  const createOp = useCreateScheduledOperation();
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const walletId = watch('walletId');
  const fromToken = watch('fromToken');
  const amount = watch('amount');
  const wallet = wallets?.find((w) => w.id === walletId);
  const balance = useWalletTokenBalance(walletId, fromToken);
  const exceeds = balance !== null && amount ? parseFloat(amount) > balance : false;

  const onSubmit = async (data: FormData) => {
    if (exceeds) {
      toast({ title: 'Insufficient balance', variant: 'destructive' });
      return;
    }
    if (!wallet) return;
    try {
      await createOp.mutateAsync({
        type: 'swap',
        scheduledFor: new Date(data.scheduledFor).toISOString(),
        memo: data.memo,
        params: {
          walletId: data.walletId,
          chain: wallet.chain,
          fromToken: data.fromToken,
          toToken: data.toToken,
          amount: data.amount,
          walletAddress: wallet.address,
        },
      });
      toast({
        title: 'Swap scheduled',
        description: `Auto-executes within ${TOLERANCE_BPS.swap}bps of quoted rate`,
        variant: 'success',
      });
      reset();
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Schedule Swap
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Wallet</Label>
            <Select {...register('walletId')}>
              <option value="">Select wallet…</option>
              {wallets?.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label ? `${w.label} · ${w.chain} (${w.address.slice(0, 6)}…${w.address.slice(-4)})` : `${w.chain} · ${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                </option>
              ))}
            </Select>
            {errors.walletId && <p className="text-sm text-red-500">{errors.walletId.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>From Token</Label>
              <Select {...register('fromToken')}>
                <option value="USDC">USDC</option>
                <option value="USDT">USDT</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To Token</Label>
              <Select {...register('toToken')}>
                <option value="USDT">USDT</option>
                <option value="USDC">USDC</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input placeholder="100.00" {...register('amount')} />
              <BalanceHint
                balance={balance}
                token={fromToken ?? 'USDC'}
                currentAmount={amount}
                onMax={(max) => setValue('amount', max)}
              />
              {errors.amount && <p className="text-sm text-red-500">{errors.amount.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Schedule For</Label>
              <Input type="datetime-local" {...register('scheduledFor')} />
              {errors.scheduledFor && <p className="text-sm text-red-500">{errors.scheduledFor.message}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Memo (optional)</Label>
            <Input placeholder="Swap reference…" {...register('memo')} />
          </div>

          <p className="text-xs text-muted-foreground">
            Auto-executes within {TOLERANCE_BPS.swap}bps of quoted rate. If rate deviates further, you&apos;ll be asked to approve.
          </p>

          <Button type="submit" className="w-full" disabled={createOp.isPending || exceeds}>
            {createOp.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scheduling…</>
            ) : (
              'Schedule Swap'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create ScheduleBridgeForm**

Create `src/components/scheduled/ScheduleBridgeForm.tsx`. Same pattern — form fields for fromWallet, toWallet, token, amount, datetime-local, memo. Uses `useCreateScheduledOperation` with `type: 'bridge'`. Show tolerance message: "Auto-executes within 25bps." Follow the same form structure as ScheduleSwapForm but with bridge-specific fields (fromWallet on one chain, toWallet on another chain, single token selector). Reference `src/components/swaps/ChainSwapForm.tsx` for the wallet selection pattern with chain filtering.

- [ ] **Step 3: Create ScheduleRampForm**

Create `src/components/scheduled/ScheduleRampForm.tsx`. Same pattern — direction (onramp/offramp), cryptoToken, fiatCurrency, amount, bankAccount selector, datetime-local, memo. Uses `useCreateScheduledOperation` with `type: 'ramp'`. Show tolerance message: "Auto-executes within 50bps." Reference `src/components/banking/RampForm.tsx` for the form field pattern and bank account selection.

- [ ] **Step 4: Update swaps page layout**

In `src/app/(app)/swaps/page.tsx`, add the ScheduleSwapForm import and update the layout to use a two-column grid like the payments page:

```typescript
import { ScheduleSwapForm } from '@/components/scheduled/ScheduleSwapForm';

// In the return, change to:
export default function SwapsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SwapForm />
        <ScheduleSwapForm />
      </div>
      <SwapHistory />
    </div>
  );
}
```

- [ ] **Step 5: Update bridges page**

Convert `src/app/(app)/bridges/page.tsx` to a client component (add `'use client';`) and update:

```typescript
'use client';
import { ChainSwapForm } from '@/components/swaps/ChainSwapForm';
import { BridgeHistory } from '@/components/bridges/BridgeHistory';
import { ScheduleBridgeForm } from '@/components/scheduled/ScheduleBridgeForm';

export default function BridgesPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChainSwapForm />
        <ScheduleBridgeForm />
      </div>
      <BridgeHistory />
    </div>
  );
}
```

Remove the `export const metadata` line (not allowed in client components — move to layout if needed).

- [ ] **Step 6: Update ramps page**

In `src/app/(app)/ramps/page.tsx`:

```typescript
'use client';
import { RampForm } from '@/components/banking/RampForm';
import { FiatTransactionTable } from '@/components/banking/FiatTransactionTable';
import { ScheduleRampForm } from '@/components/scheduled/ScheduleRampForm';

export default function RampsPage() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RampForm />
        <ScheduleRampForm />
      </div>
      <FiatTransactionTable />
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/scheduled/ src/app/\(app\)/swaps/page.tsx src/app/\(app\)/bridges/page.tsx src/app/\(app\)/ramps/page.tsx
git commit -m "feat: add schedule forms for swaps, bridges, and ramps"
```

---

## Task 9: AI Approvals Dashboard Card + ApprovalModal

**Files:**
- Create: `src/components/scheduled/ApprovalModal.tsx`
- Modify: `src/components/charts/RecommendationsCard.tsx`

- [ ] **Step 1: Create ApprovalModal**

Create `src/components/scheduled/ApprovalModal.tsx`:

```typescript
'use client';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  useApproveScheduledOperation,
  useCancelScheduledOperation,
} from '@/hooks/useScheduledOperations';
import { getBankingAdapter } from '@/lib/banking/factory';
import { extractRate, calculateDeviationBps } from '@/lib/scheduled-operations/tolerances';
import type { ScheduledOperation, SwapParams, BridgeParams, RampParams } from '@/types/scheduled-operations';
import { Loader2 } from 'lucide-react';

function useCountdown(expiresAt: string | null): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!expiresAt) { setLabel(''); return; }
    function update() {
      const ms = new Date(expiresAt!).getTime() - Date.now();
      if (ms <= 0) { setLabel('Expired'); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setLabel(h > 0 ? `${h}h ${m}m` : `${m}m`);
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return label;
}

function formatOpSummary(op: ScheduledOperation): string {
  switch (op.type) {
    case 'swap': {
      const p = op.params as SwapParams;
      return `${p.amount} ${p.fromToken} → ${p.toToken} on ${p.chain}`;
    }
    case 'bridge': {
      const p = op.params as BridgeParams;
      return `${p.amount} ${p.token} from ${p.fromChain} → ${p.toChain}`;
    }
    case 'ramp': {
      const p = op.params as RampParams;
      return `${p.direction === 'onramp' ? 'On-ramp' : 'Off-ramp'} ${p.cryptoAmount} ${p.cryptoToken}`;
    }
    default:
      return op.type;
  }
}

interface ApprovalModalProps {
  op: ScheduledOperation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApprovalModal({ op, open, onOpenChange }: ApprovalModalProps) {
  const { toast } = useToast();
  const approve = useApproveScheduledOperation();
  const cancel = useCancelScheduledOperation();
  const countdown = useCountdown(op?.expires_at ?? null);

  const [freshRate, setFreshRate] = useState<number | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);

  // Fetch fresh quote when modal opens
  useEffect(() => {
    if (!open || !op) return;
    setLoadingQuote(true);
    setFreshRate(null);

    fetch(`/api/scheduled-operations/${op.id}`)
      .then((res) => res.json())
      .then(({ data }) => {
        if (data?.execution_quote) {
          setFreshRate(extractRate(op.type, data.execution_quote));
        } else if (data?.initial_quote) {
          // No execution quote yet — use initial as baseline
          setFreshRate(extractRate(op.type, data.initial_quote));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingQuote(false));
  }, [open, op]);

  if (!op) return null;

  const originalRate = extractRate(op.type, op.initial_quote);
  const currentDeviation = freshRate !== null ? calculateDeviationBps(originalRate, freshRate) : op.deviation_bps ?? 0;
  const withinTolerance = currentDeviation <= op.tolerance_bps;

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(op.id);
      toast({ title: 'Operation executed', variant: 'success' });
      onOpenChange(false);
    } catch (err) {
      toast({ title: 'Execution failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleDeny = async () => {
    try {
      await cancel.mutateAsync(op.id);
      toast({ title: 'Operation cancelled', variant: 'success' });
      onOpenChange(false);
    } catch (err) {
      toast({ title: 'Cancellation failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Scheduled {op.type.charAt(0).toUpperCase() + op.type.slice(1)} — Review
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm font-medium">{formatOpSummary(op)}</div>

          {op.memo && (
            <p className="text-xs text-muted-foreground italic">&ldquo;{op.memo}&rdquo;</p>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm bg-muted/40 rounded-md p-3">
            <div>
              <span className="text-muted-foreground text-xs">Original Rate</span>
              <div className="font-medium tabular-nums">{originalRate.toFixed(6)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Current Rate</span>
              <div className="font-medium tabular-nums">
                {loadingQuote ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  freshRate?.toFixed(6) ?? '—'
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Deviation:</span>
            <Badge variant={withinTolerance ? ('success' as any) : 'destructive'}>
              {currentDeviation} bps
            </Badge>
            <span className="text-xs text-muted-foreground">(limit: {op.tolerance_bps} bps)</span>
          </div>

          {countdown && (
            <p className="text-xs text-muted-foreground">Expires in {countdown}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleDeny} disabled={cancel.isPending}>
            {cancel.isPending ? 'Cancelling…' : 'Deny'}
          </Button>
          <Button onClick={handleApprove} disabled={approve.isPending || loadingQuote}>
            {approve.isPending ? 'Executing…' : 'Approve & Execute'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Update RecommendationsCard to AI Approvals**

In `src/components/charts/RecommendationsCard.tsx`, make these changes:

1. Rename all "AI Recommendations" text to "AI Approvals" in the JSX (CardTitle, empty state text)
2. Import `usePendingApprovals` from `@/hooks/useScheduledOperations` and `ApprovalModal` from `@/components/scheduled/ApprovalModal`
3. Add state for the selected scheduled operation: `const [selectedOp, setSelectedOp] = useState<ScheduledOperation | null>(null)`
4. Fetch pending approvals: `const { data: pendingOps } = usePendingApprovals()`
5. Update the `pendingCount` to include both recommendation pending count and `(pendingOps ?? []).length`
6. Before the recommendation list, render pending scheduled operations as inline cards with a "Review" button (no approve/deny at this level)
7. After action is taken on a scheduled op, show "Approved" or "Denied" badge instead of the Review button
8. The Review button opens `<ApprovalModal op={selectedOp} open={!!selectedOp} onOpenChange={(o) => !o && setSelectedOp(null)} />`
9. For existing AI recommendations, change the inline expand + approve/deny pattern to also open a modal. Create a `<RecommendationModal>` using the same Dialog pattern — shows reasoning, impact data (the expanded content that's currently inline), and approve/deny buttons. Replace the `expanded` state toggle + inline expand with a "Review" button that opens this modal.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduled/ApprovalModal.tsx src/components/charts/RecommendationsCard.tsx
git commit -m "feat: rename AI Recommendations to AI Approvals, add approval modal for scheduled ops"
```

---

## Task 10: Notifications Panel Update

**Files:**
- Modify: `src/components/notifications/NotificationsPanel.tsx`

- [ ] **Step 1: Add scheduled operation notification dots**

In `src/components/notifications/NotificationsPanel.tsx`, add these entries to the `ACTION_DOT` mapping:

```typescript
  scheduled_operation_create:    'bg-indigo-500',
  scheduled_operation_execute:   'bg-emerald-500',
  scheduled_operation_deviation: 'bg-amber-500',
  scheduled_operation_approve:   'bg-green-500',
  scheduled_operation_cancel:    'bg-red-500',
  scheduled_operation_expire:    'bg-gray-500',
```

These will automatically appear in the notifications dropdown since they're audit log entries fetched from `/api/audit`.

- [ ] **Step 2: Commit**

```bash
git add src/components/notifications/NotificationsPanel.tsx
git commit -m "feat: add scheduled operation notification colors"
```

---

## Task 11: Agent Tools

**Files:**
- Modify: `src/lib/agent/tools.ts`
- Modify: `src/lib/agent/context.ts`

- [ ] **Step 1: Add 6 new agent tools**

In `src/lib/agent/tools.ts`, add these tools before the `ALL_TOOLS` array:

```typescript
const scheduleSwap: AgentTool = {
  name: 'schedule_swap',
  description: 'Schedule a future token swap. Fetches a quote at scheduling time and re-quotes at execution time. Auto-executes if rate is within 10bps tolerance. Always confirm with the user before calling.',
  input_schema: {
    type: 'object',
    properties: {
      walletId: { type: 'string', description: 'Wallet UUID' },
      chain: { type: 'string', enum: ['ethereum', 'solana'] },
      fromToken: { type: 'string', enum: ['USDC', 'USDT'] },
      toToken: { type: 'string', enum: ['USDC', 'USDT'] },
      amount: { type: 'string', description: 'Amount to swap' },
      walletAddress: { type: 'string', description: 'Wallet address' },
      scheduledFor: { type: 'string', description: 'ISO timestamp for when to execute' },
      memo: { type: 'string', description: 'Optional memo' },
    },
    required: ['walletId', 'chain', 'fromToken', 'toToken', 'amount', 'walletAddress', 'scheduledFor'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/scheduled-operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
      body: JSON.stringify({
        type: 'swap',
        scheduledFor: input.scheduledFor,
        memo: input.memo,
        params: { walletId: input.walletId, chain: input.chain, fromToken: input.fromToken, toToken: input.toToken, amount: input.amount, walletAddress: input.walletAddress },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Failed to schedule swap');
    return { operationId: json.data.id, status: 'scheduled', scheduledFor: input.scheduledFor, toleranceBps: json.toleranceBps };
  },
};

const scheduleBridge: AgentTool = {
  name: 'schedule_bridge',
  description: 'Schedule a future cross-chain bridge transfer. Auto-executes if fee deviation is within 25bps tolerance. Always confirm with the user before calling.',
  input_schema: {
    type: 'object',
    properties: {
      fromWalletId: { type: 'string', description: 'Source wallet UUID' },
      toWalletId: { type: 'string', description: 'Destination wallet UUID' },
      token: { type: 'string', enum: ['USDC', 'USDT'] },
      amount: { type: 'string', description: 'Amount to bridge' },
      fromChain: { type: 'string', enum: ['ethereum', 'solana'] },
      toChain: { type: 'string', enum: ['ethereum', 'solana'] },
      walletAddress: { type: 'string', description: 'Source wallet address' },
      scheduledFor: { type: 'string', description: 'ISO timestamp' },
      memo: { type: 'string', description: 'Optional memo' },
    },
    required: ['fromWalletId', 'toWalletId', 'token', 'amount', 'fromChain', 'toChain', 'walletAddress', 'scheduledFor'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/scheduled-operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
      body: JSON.stringify({
        type: 'bridge',
        scheduledFor: input.scheduledFor,
        memo: input.memo,
        params: { fromWalletId: input.fromWalletId, toWalletId: input.toWalletId, token: input.token, amount: input.amount, fromChain: input.fromChain, toChain: input.toChain, walletAddress: input.walletAddress },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Failed to schedule bridge');
    return { operationId: json.data.id, status: 'scheduled', scheduledFor: input.scheduledFor, toleranceBps: json.toleranceBps };
  },
};

const scheduleRamp: AgentTool = {
  name: 'schedule_ramp',
  description: 'Schedule a future on-ramp or off-ramp. Auto-executes if exchange rate deviation is within 50bps tolerance. Always confirm with the user before calling.',
  input_schema: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['onramp', 'offramp'] },
      cryptoToken: { type: 'string', enum: ['USDC', 'USDT'] },
      fiatCurrency: { type: 'string', description: 'Fiat currency code (USD, EUR, GBP)' },
      cryptoAmount: { type: 'number', description: 'Crypto amount' },
      bankAccountId: { type: 'string', description: 'Bank account UUID' },
      walletId: { type: 'string', description: 'Wallet UUID (optional)' },
      scheduledFor: { type: 'string', description: 'ISO timestamp' },
      memo: { type: 'string', description: 'Optional memo' },
    },
    required: ['direction', 'cryptoToken', 'fiatCurrency', 'cryptoAmount', 'bankAccountId', 'scheduledFor'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/scheduled-operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
      body: JSON.stringify({
        type: 'ramp',
        scheduledFor: input.scheduledFor,
        memo: input.memo,
        params: { direction: input.direction, cryptoToken: input.cryptoToken, fiatCurrency: input.fiatCurrency, cryptoAmount: input.cryptoAmount, bankAccountId: input.bankAccountId, walletId: input.walletId },
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Failed to schedule ramp');
    return { operationId: json.data.id, status: 'scheduled', scheduledFor: input.scheduledFor, toleranceBps: json.toleranceBps };
  },
};

const getScheduledOperations: AgentTool = {
  name: 'get_scheduled_operations',
  description: 'List pending or awaiting scheduled operations (swaps, bridges, ramps).',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['swap', 'bridge', 'ramp'], description: 'Filter by type (optional)' },
      status: { type: 'string', enum: ['pending', 'awaiting_authorization', 'completed', 'failed', 'cancelled', 'expired'], description: 'Filter by status (optional)' },
    },
    required: [],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const params = new URLSearchParams();
    if (input.type) params.set('type', input.type as string);
    if (input.status) params.set('status', input.status as string);
    const { data } = await ctx.supabase
      .from('scheduled_operations')
      .select('*')
      .eq('enterprise_id', ctx.enterpriseId)
      .order('created_at', { ascending: false })
      .limit(20);
    return data ?? [];
  },
};

const cancelScheduledOperation: AgentTool = {
  name: 'cancel_scheduled_operation',
  description: 'Cancel a pending or awaiting_authorization scheduled operation.',
  input_schema: {
    type: 'object',
    properties: {
      operationId: { type: 'string', description: 'Scheduled operation UUID' },
    },
    required: ['operationId'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const { data: op } = await ctx.supabase
      .from('scheduled_operations')
      .select('id, status, type')
      .eq('id', input.operationId as string)
      .eq('enterprise_id', ctx.enterpriseId)
      .single();
    if (!op) throw new Error('Operation not found');
    if (op.status !== 'pending' && op.status !== 'awaiting_authorization') {
      throw new Error(`Cannot cancel operation with status '${op.status}'`);
    }
    await ctx.supabase
      .from('scheduled_operations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', input.operationId as string);
    await writeAuditLog({ userId: ctx.userId, action: 'scheduled_operation_cancel' as any, entityType: 'scheduled_operation', entityId: input.operationId as string, details: { type: op.type } });
    return { success: true, operationId: input.operationId };
  },
};

const approveScheduledOperation: AgentTool = {
  name: 'approve_scheduled_operation',
  description: 'Approve and execute a scheduled operation that is awaiting authorization. Always confirm with the user before calling.',
  input_schema: {
    type: 'object',
    properties: {
      operationId: { type: 'string', description: 'Scheduled operation UUID' },
    },
    required: ['operationId'],
  },
  minRole: 'treasury_manager',
  async handler(input, ctx) {
    const res = await fetch(`${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/scheduled-operations/${input.operationId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-user-id': ctx.userId, 'x-agent-enterprise-id': ctx.enterpriseId ?? '' },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Approval failed');
    return { success: true, txHash: json.txHash };
  },
};
```

- [ ] **Step 2: Add new tools to ALL_TOOLS array**

In `src/lib/agent/tools.ts`, add to the `ALL_TOOLS` array under the "Treasury manager only" section:

```typescript
  // Scheduled operations
  scheduleSwap,
  scheduleBridge,
  scheduleRamp,
  getScheduledOperations,
  cancelScheduledOperation,
  approveScheduledOperation,
```

- [ ] **Step 3: Update system prompt**

In `src/lib/agent/context.ts`, update the `treasury_manager` role capability string to include scheduling context:

Replace the treasury_manager string with:

```typescript
treasury_manager: `You have full access. You can read all data and also create/schedule payments, execute on/off-ramp transactions (USD, EUR, GBP), execute token swaps, manage yield deposits/withdrawals, and approve or reject AI recommendations. You can also perform combined withdraw-and-offramp operations from yield to fiat. You can schedule future swaps, bridges, and ramps — these will auto-execute at the scheduled time if the re-quoted rate is within tolerance (swap: 10bps, bridge: 25bps, ramp: 50bps). If the rate deviates beyond tolerance, the operation requires manual approval. You can proactively suggest scheduling operations based on cash flow analysis, AR/AP, treasury reserves, and invoices. For any payment, swap, or ramp action over $10,000, you MUST summarize the action and ask the user to confirm before calling the execute or schedule tool.`,
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/tools.ts src/lib/agent/context.ts
git commit -m "feat: add agent tools for scheduling/managing swaps, bridges, and ramps"
```

---

## Task 12: Build Verification

- [ ] **Step 1: Run the build**

```bash
cd C:/Users/John/crypto-treasury && npm run build
```

Expected: Build succeeds. Fix any TypeScript errors.

- [ ] **Step 2: Verify dev server**

```bash
npm run dev
```

Navigate to:
- `/swaps` — should show SwapForm + ScheduleSwapForm side by side
- `/bridges` — should show ChainSwapForm + ScheduleBridgeForm side by side
- `/ramps` — should show RampForm + ScheduleRampForm side by side
- `/dashboard` — should show "AI Approvals" card title

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from scheduled operations implementation"
```
