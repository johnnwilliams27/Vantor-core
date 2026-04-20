# Yield Pending-Write Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop orphaning on-chain yield deposits when the browser dies or the confirm-deposit call fails — the on-chain state and Vantor's DB must converge.

**Architecture:** Two-layer fix. (1) Fix the real bug: `confirm-deposit` today requires `yieldToken` + `tokensReceived` fields that neither `useOnChainDeposit` nor `useSolanaDeposit` send — so EVERY on-chain deposit currently 400s and orphans. We derive those server-side from a canonical protocol map. (2) Close the remaining race window: as soon as `writeContractAsync` (eth) / `sendTransaction` (sol) returns a tx hash, POST `/api/yield/record-pending-deposit` which inserts a `yield_transactions` row with `status='pending'` (idempotent on `tx_hash`). `confirm-deposit` then promotes pending → completed and creates/updates the `yield_positions` row. If the browser dies between signing and confirming, the pending row survives and a future reconcile cron (out of scope here) can resolve it.

**Tech Stack:** Next.js 14 App Router, Supabase (service-role admin client), zod, vitest. No schema migration — `yield_tx_status` enum already has `pending`.

---

## File Structure

- **Create:**
  - `src/lib/yield/yield-tokens.ts` — canonical `YIELD_TOKENS` map + `getYieldTokenSymbol(protocol)` export.
  - `src/app/api/yield/record-pending-deposit/route.ts` — new POST endpoint.
  - `src/app/api/yield/record-pending-deposit/route.test.ts`.
  - `src/app/api/yield/confirm-deposit/route.test.ts`.
  - `src/lib/yield/yield-tokens.test.ts`.
- **Modify:**
  - `src/lib/yield/mock/yield-mock.ts:68-86` — import from new shared module, remove local copy.
  - `src/app/api/yield/confirm-deposit/route.ts:13-22` — make `yieldToken` / `tokensReceived` optional, derive defaults.
  - `src/app/api/yield/confirm-deposit/route.ts:71-80` — promote `pending` rows instead of 409.
  - `src/hooks/useOnChainDeposit.ts:80-82` — POST to record-pending after `writeContractAsync` returns.
  - `src/hooks/useSolanaDeposit.ts:68-69` — POST to record-pending after `sendTransaction` returns.

---

### Task 1: Extract YIELD_TOKENS to shared module

**Files:**
- Create: `src/lib/yield/yield-tokens.ts`
- Create: `src/lib/yield/yield-tokens.test.ts`
- Modify: `src/lib/yield/mock/yield-mock.ts:68-86`

- [ ] **Step 1: Write the failing test**

`src/lib/yield/yield-tokens.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getYieldTokenSymbol, YIELD_TOKENS } from './yield-tokens';

describe('getYieldTokenSymbol', () => {
  it('returns the receipt-token symbol for known protocols', () => {
    expect(getYieldTokenSymbol('compound_v3')).toBe('cUSDCv3');
    expect(getYieldTokenSymbol('aave_v3')).toBe('aUSDC');
    expect(getYieldTokenSymbol('morpho_reservoir')).toBe('bbqUSDCreservoir');
    expect(getYieldTokenSymbol('kamino')).toBe('kUSDC');
  });

  it('throws for unknown protocol', () => {
    expect(() => getYieldTokenSymbol('not_a_protocol' as never)).toThrow(
      /unknown yield protocol/i,
    );
  });

  it('covers every YieldProtocolId without gaps', () => {
    // Catch future additions that forget to add a receipt token
    for (const key of Object.keys(YIELD_TOKENS)) {
      expect(typeof YIELD_TOKENS[key as keyof typeof YIELD_TOKENS]).toBe('string');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/yield/yield-tokens.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module**

`src/lib/yield/yield-tokens.ts`:
```typescript
import type { YieldProtocolId } from './interface';

/**
 * Canonical receipt-token symbols by protocol. Single source of truth — the
 * mock adapter, confirm-deposit, and record-pending-deposit all read from
 * here. When adding a new protocol, add it here first or tests will fail.
 */
export const YIELD_TOKENS: Record<YieldProtocolId, string> = {
  aave_v3:           'aUSDC',
  compound_v3:       'cUSDCv3',
  morpho_reservoir:  'bbqUSDCreservoir',
  morpho_steakhouse: 'mshUSDC',
  kamino:            'kUSDC',
  kamino_multiply:   'kmUSDC',
  ondo_usdy:         'USDY',
  sky:               'sUSDS',
  ethena:            'sUSDe',
  buidl:             'BUIDL',
  ousg:              'OUSG',
  ustb:              'USTB',
  benji:             'BENJI',
  usyc:              'USYC',
  spiko_usd:         'USTBL',
};

export function getYieldTokenSymbol(protocol: YieldProtocolId): string {
  const sym = YIELD_TOKENS[protocol];
  if (!sym) throw new Error(`unknown yield protocol: ${protocol}`);
  return sym;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run src/lib/yield/yield-tokens.test.ts`

- [ ] **Step 5: Dedupe yield-mock.ts**

In `src/lib/yield/mock/yield-mock.ts`, replace lines 68-86 (the local `YIELD_TOKENS` const) with:
```typescript
import { YIELD_TOKENS } from '../yield-tokens';
```
(add the import at the top with the other `../` imports; leave the `YIELD_TOKENS[this.protocol]` usage on line 151 untouched).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/yield/yield-tokens.ts src/lib/yield/yield-tokens.test.ts src/lib/yield/mock/yield-mock.ts
git commit -m "refactor(yield): extract YIELD_TOKENS constant to shared module"
```

---

### Task 2: Fix confirm-deposit zod bug (yieldToken/tokensReceived now optional)

**Files:**
- Modify: `src/app/api/yield/confirm-deposit/route.ts:13-22`, `:44`
- Create: `src/app/api/yield/confirm-deposit/route.test.ts`

**Context:** Today's zod requires `yieldToken` + `tokensReceived`, but `useOnChainDeposit.ts:91-102` and `useSolanaDeposit.ts:77-88` send neither. Every on-chain deposit currently 400s at this endpoint. That's the real orphan root cause.

- [ ] **Step 1: Write the failing test**

`src/app/api/yield/confirm-deposit/route.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

// These are pure schema tests — we test the zod shape directly without
// mounting the whole route. The route-level auth/rate-limit/role plumbing
// is exercised by higher-level integration tests.

import { confirmDepositInputSchema } from './schema';

describe('confirmDepositInputSchema', () => {
  const base = {
    protocol: 'compound_v3',
    token: 'USDC',
    amount: '10',
    walletAddress: '0x51e048a166D22e2898790a4806652bCFf6F03A36',
    chain: 'ethereum',
    txHash: '0xabc',
  };

  it('accepts the minimal client payload without yieldToken/tokensReceived', () => {
    const res = confirmDepositInputSchema.safeParse(base);
    expect(res.success).toBe(true);
  });

  it('accepts the full payload when client does send yieldToken/tokensReceived', () => {
    const res = confirmDepositInputSchema.safeParse({
      ...base,
      yieldToken: 'cUSDCv3',
      tokensReceived: 10.1,
    });
    expect(res.success).toBe(true);
  });

  it('rejects missing amount', () => {
    const res = confirmDepositInputSchema.safeParse({ ...base, amount: undefined });
    expect(res.success).toBe(false);
  });

  it('rejects non-positive amount', () => {
    const res = confirmDepositInputSchema.safeParse({ ...base, amount: '0' });
    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/app/api/yield/confirm-deposit/route.test.ts`
Expected: FAIL — `./schema` not found.

- [ ] **Step 3: Extract the schema**

Create `src/app/api/yield/confirm-deposit/schema.ts`:
```typescript
import { z } from 'zod';

export const confirmDepositInputSchema = z.object({
  protocol: z.string().min(1),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  chain: z.enum(['ethereum', 'solana']),
  txHash: z.string().min(1),
  yieldToken: z.string().min(1).optional(),
  tokensReceived: z.number().positive().optional(),
});

export type ConfirmDepositInput = z.infer<typeof confirmDepositInputSchema>;
```

In `src/app/api/yield/confirm-deposit/route.ts`:
- Delete the inline `confirmDepositSchema` (lines 13-22).
- At top, add: `import { confirmDepositInputSchema } from './schema';`
- Replace `const parsed = confirmDepositSchema.safeParse(body);` (line 39) with `const parsed = confirmDepositInputSchema.safeParse(body);`
- In the destructure on line 44, change to:
  ```typescript
  const { protocol, token, amount, walletAddress, chain, txHash } = parsed.data;
  const yieldToken = parsed.data.yieldToken ?? getYieldTokenSymbol(protocol as YieldProtocolId);
  const tokensReceived = parsed.data.tokensReceived ?? parseFloat(amount);
  ```
- Add imports at top:
  ```typescript
  import { getYieldTokenSymbol } from '@/lib/yield/yield-tokens';
  import type { YieldProtocolId } from '@/lib/yield/interface';
  ```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run src/app/api/yield/confirm-deposit/route.test.ts`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/yield/confirm-deposit/
git commit -m "fix(yield): make confirm-deposit yieldToken/tokensReceived optional (server derives defaults)"
```

---

### Task 3: Add `/api/yield/record-pending-deposit` endpoint

**Files:**
- Create: `src/app/api/yield/record-pending-deposit/route.ts`
- Create: `src/app/api/yield/record-pending-deposit/route.test.ts`
- Create: `src/app/api/yield/record-pending-deposit/schema.ts`

**Semantics:**
- POST with same payload as confirm-deposit (minus blockNumber).
- Creates `yield_transactions` row with `status='pending'`, `position_id=NULL` (position is created later by confirm-deposit).
- Idempotent on `tx_hash` — second call returns same row, 200.
- Same auth as confirm-deposit: session + Treasury Manager role + paid tier.
- NO policy gate (matches confirm-deposit — user already signed on-chain, can't be undone).

- [ ] **Step 1: Write the failing schema test**

`src/app/api/yield/record-pending-deposit/route.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { recordPendingDepositInputSchema } from './schema';

describe('recordPendingDepositInputSchema', () => {
  const base = {
    protocol: 'compound_v3',
    token: 'USDC',
    amount: '10',
    walletAddress: '0x51e048a166D22e2898790a4806652bCFf6F03A36',
    chain: 'ethereum',
    txHash: '0xabc123',
  };

  it('accepts minimal client payload', () => {
    expect(recordPendingDepositInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects missing txHash', () => {
    expect(
      recordPendingDepositInputSchema.safeParse({ ...base, txHash: '' }).success,
    ).toBe(false);
  });

  it('rejects unknown chain', () => {
    expect(
      recordPendingDepositInputSchema.safeParse({ ...base, chain: 'polygon' }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/app/api/yield/record-pending-deposit/route.test.ts`

- [ ] **Step 3: Create schema and route**

`src/app/api/yield/record-pending-deposit/schema.ts`:
```typescript
import { z } from 'zod';

export const recordPendingDepositInputSchema = z.object({
  protocol: z.string().min(1),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  chain: z.enum(['ethereum', 'solana']),
  txHash: z.string().min(1),
});

export type RecordPendingDepositInput = z.infer<typeof recordPendingDepositInputSchema>;
```

`src/app/api/yield/record-pending-deposit/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';
import { recordPendingDepositInputSchema } from './schema';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('deposit into yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-record-pending', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = recordPendingDepositInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { protocol, token, amount, chain, txHash } = parsed.data;
  const supabase = createAdminClient();

  // Idempotent on tx_hash — second call with same hash returns the existing row.
  const { data: existing } = await supabase
    .from('yield_transactions')
    .select('id, status')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { id: existing.id, status: existing.status, alreadyRecorded: true },
      { status: 200 },
    );
  }

  const { data: row, error } = await supabase
    .from('yield_transactions')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      protocol,
      chain,
      tx_type: 'deposit',
      underlying_token: token,
      amount: parseFloat(amount),
      amount_usd: parseFloat(amount),
      tx_hash: txHash,
      status: 'pending',
      metadata: { onChain: true, recordedAt: new Date().toISOString() },
    })
    .select('id')
    .single();

  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? 'Failed to record pending deposit' }, { status: 500 });
  }

  return NextResponse.json({ id: row.id, status: 'pending' }, { status: 201 });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npx vitest run src/app/api/yield/record-pending-deposit/route.test.ts`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/yield/record-pending-deposit/
git commit -m "feat(yield): add /api/yield/record-pending-deposit for pre-confirm bookkeeping"
```

---

### Task 4: Teach confirm-deposit to promote pending rows

**Files:**
- Modify: `src/app/api/yield/confirm-deposit/route.ts:71-80`
- Modify: `src/app/api/yield/confirm-deposit/route.test.ts` (append)

**Semantics change:** Today lines 71-80 return 409 if a row with tx_hash exists. New behavior: if existing row has `status='pending'`, promote it (update to completed, link to the position row created later in the function). If `status='completed'` → still 409 (already recorded).

Because the full route carries heavy auth/role/tier plumbing, we test the promotion logic as a tiny pure helper rather than mounting the route.

- [ ] **Step 1: Write the failing promotion test**

Append to `src/app/api/yield/confirm-deposit/route.test.ts`:
```typescript
import { decideExistingTxAction } from './promote';

describe('decideExistingTxAction', () => {
  it('promotes when status is pending', () => {
    expect(decideExistingTxAction({ id: 't1', status: 'pending' })).toEqual({
      kind: 'promote',
      txId: 't1',
    });
  });

  it('409s when status is completed', () => {
    expect(decideExistingTxAction({ id: 't1', status: 'completed' })).toEqual({
      kind: 'conflict',
    });
  });

  it('409s when status is failed', () => {
    expect(decideExistingTxAction({ id: 't1', status: 'failed' })).toEqual({
      kind: 'conflict',
    });
  });

  it('treats no existing row as insert', () => {
    expect(decideExistingTxAction(null)).toEqual({ kind: 'insert' });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/app/api/yield/confirm-deposit/route.test.ts`

- [ ] **Step 3: Create the helper**

`src/app/api/yield/confirm-deposit/promote.ts`:
```typescript
export type ExistingTxRow = { id: string; status: string } | null | undefined;

export type ExistingTxAction =
  | { kind: 'insert' }
  | { kind: 'promote'; txId: string }
  | { kind: 'conflict' };

export function decideExistingTxAction(row: ExistingTxRow): ExistingTxAction {
  if (!row) return { kind: 'insert' };
  if (row.status === 'pending') return { kind: 'promote', txId: row.id };
  return { kind: 'conflict' };
}
```

- [ ] **Step 4: Wire it into the route**

In `src/app/api/yield/confirm-deposit/route.ts`, replace lines 71-80 (the existingTx 409 block) with:
```typescript
  // If a record-pending-deposit call already wrote a pending row for this
  // tx_hash, promote it instead of duplicating. See plan
  // docs/superpowers/plans/2026-04-19-yield-pending-writes.md.
  const { data: existingTx } = await supabase
    .from('yield_transactions')
    .select('id, status')
    .eq('tx_hash', txHash)
    .maybeSingle();

  const action = decideExistingTxAction(existingTx);
  if (action.kind === 'conflict') {
    return NextResponse.json({ error: 'Transaction already recorded' }, { status: 409 });
  }
```

Add import at top: `import { decideExistingTxAction } from './promote';`

Then at the tx-insert site (lines 146-167), branch on `action.kind`:
```typescript
  if (action.kind === 'promote') {
    const { error: updErr } = await supabase
      .from('yield_transactions')
      .update({
        position_id: positionId,
        status: 'completed',
        executed_at: new Date().toISOString(),
        metadata: { yieldToken, tokensReceived, onChain: true, promotedFromPending: true },
      })
      .eq('id', action.txId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  } else {
    // existing insert path — unchanged
    const { error: txErr } = await supabase
      .from('yield_transactions')
      .insert({ /* ... unchanged ... */ });
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 });
  }
```

- [ ] **Step 5: Run test — expect PASS**

Run: `npx vitest run src/app/api/yield/confirm-deposit/route.test.ts`

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/yield/confirm-deposit/
git commit -m "feat(yield): promote pending yield_transactions rows on confirm-deposit"
```

---

### Task 5: Wire useOnChainDeposit to POST pending before waiting for receipt

**Files:**
- Modify: `src/hooks/useOnChainDeposit.ts:80-82`

**Semantics:** After `writeContractAsync(depositArgs)` returns the hash, before `waitForTransactionReceipt`, POST to `/api/yield/record-pending-deposit`. If this fails, log but continue (non-fatal — user already signed). Wrap in try/catch — do NOT surface to UI as a deposit failure.

- [ ] **Step 1: Locate the insertion point**

Read `src/hooks/useOnChainDeposit.ts` lines 78-85 to refresh:
```typescript
        setStep('depositing');
        const depositArgs = buildDepositTx(protocol, token, amount, walletAddress);
        const depositTxHash = await writeContractAsync(depositArgs);
        setTxHash(depositTxHash);

        // Step 4: Wait for confirmation
        setStep('confirming');
```

- [ ] **Step 2: Insert the pending-record call**

Between `setTxHash(depositTxHash);` and `// Step 4: Wait for confirmation`, insert:
```typescript
        // Record a pending row server-side immediately. If the browser crashes
        // during waitForTransactionReceipt, or confirm-deposit fails later,
        // this row plus the tx hash is enough for a reconcile job (or a human)
        // to resolve the position. Non-fatal if it fails — user already signed.
        try {
          await fetch('/api/yield/record-pending-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              protocol,
              token,
              amount,
              walletAddress,
              chain,
              txHash: depositTxHash,
            }),
          });
        } catch (e) {
          console.warn('[yield-deposit] pending-record call failed (non-fatal)', e);
        }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOnChainDeposit.ts
git commit -m "feat(yield): record pending tx server-side as soon as wallet signs (eth)"
```

---

### Task 6: Wire useSolanaDeposit with the same pattern

**Files:**
- Modify: `src/hooks/useSolanaDeposit.ts:68-72`

- [ ] **Step 1: Locate the insertion point**

Read lines 67-75:
```typescript
        const signature = await sendTransaction(tx, connection);
        setTxHash(signature);

        // Step 3: Confirm transaction
        setStep('confirming');
        await connection.confirmTransaction(signature, 'confirmed');
```

- [ ] **Step 2: Insert pending-record call after `setTxHash`**

Between `setTxHash(signature);` and `// Step 3: Confirm transaction`, insert:
```typescript
        try {
          await fetch('/api/yield/record-pending-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              protocol,
              token,
              amount,
              walletAddress,
              chain,
              txHash: signature,
            }),
          });
        } catch (e) {
          console.warn('[yield-deposit] pending-record call failed (non-fatal)', e);
        }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useSolanaDeposit.ts
git commit -m "feat(yield): record pending tx server-side as soon as wallet signs (sol)"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite (yield-scoped)**

Run: `npx vitest run src/lib/yield src/app/api/yield src/app/api/cron/yield-rates`
Expected: all pass.

- [ ] **Step 3: Manual smoke test in dev**

Tester should:
1. Open the app in incognito + metamask extension available.
2. Start a Compound v3 USDC deposit for a small amount.
3. In Network tab, confirm `/api/yield/record-pending-deposit` is POSTed with 201 as soon as the deposit tx is signed (before the transaction confirms on-chain).
4. Confirm `/api/yield/confirm-deposit` runs after receipt arrives and returns 201.
5. Close the tab between (3) and (4) in a repeat run — verify that `yield_transactions` has a `status='pending'` row in Supabase that a human can reconcile later.

- [ ] **Step 4: Push and PR**

```bash
git push -u origin feature/yield-pending-writes
gh pr create --title "Yield: record pending tx server-side before waiting for confirmation" --body "..."
```

---

## Out of Scope (future work)

- **Reconcile cron** — scans `yield_transactions` where `status='pending'` older than N minutes, checks on-chain confirmation, flips to `completed` or `failed`, creates position. Will be its own plan once this lands.
- **On-chain balance watcher** — nightly reconcile of `cUSDCv3` / `aToken` / etc. balances vs `yield_positions`. Different plan.
- **Self-service "import by tx hash" UI** — once the reconcile cron exists, this is trivial.
