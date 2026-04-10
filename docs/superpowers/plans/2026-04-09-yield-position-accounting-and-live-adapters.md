# Yield Position Accounting & Live Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix yield position accounting (cost basis, partial withdrawals, yield tracking) and build real on-chain position adapters for all 11 yield protocols.

**Architecture:** Two-source-of-truth model: blockchain = current value, our DB = cost basis. Position tracking uses average cost basis for partial withdrawal accounting. Each protocol gets a live adapter that queries on-chain balances via the existing viem/RPC infrastructure. The mock adapter stays for lite-tier/test-mode users.

**Tech Stack:** viem (Ethereum RPC), @solana/web3.js (Solana RPC), Morpho GraphQL API, Kamino REST API, existing `ethereumClient` from `src/lib/yield/rates/client.ts`

---

## File Structure

### New files
- `src/lib/yield/adapters/aave-v3.ts` — Live Aave V3 adapter (deposit/withdraw/getPosition via on-chain)
- `src/lib/yield/adapters/compound-v3.ts` — Live Compound V3 adapter
- `src/lib/yield/adapters/morpho.ts` — Live Morpho Blue + Steakhouse adapter
- `src/lib/yield/adapters/sky.ts` — Live Sky sUSDS adapter
- `src/lib/yield/adapters/ethena.ts` — Live Ethena sUSDe adapter
- `src/lib/yield/adapters/ondo.ts` — Live Ondo USDY adapter
- `src/lib/yield/adapters/kamino.ts` — Live Kamino adapter (Solana)
- `src/lib/yield/adapters/drift.ts` — Live Drift adapter (Solana)
- `src/lib/yield/adapters/constants.ts` — Contract addresses, ABIs shared across adapters
- `src/lib/yield/position-accounting.ts` — Cost basis calculation, partial withdrawal math
- `supabase/migrations/0029_yield_position_token_balance.sql` — Add `yield_token_balance` column

### Modified files
- `src/lib/yield/interface.ts` — Add `yield_token_balance` to PositionInfo, add `getOnChainValue()` to IYieldProtocol
- `src/lib/yield/factory.ts` — Route to live adapters based on integration mode
- `src/lib/yield/mock/yield-mock.ts` — Fix accounting bugs in mock too
- `src/app/api/yield/deposit/route.ts` — Fix cost basis tracking, don't reset current_value_usd
- `src/app/api/yield/withdraw/route.ts` — Proportional cost basis reduction on partial withdrawal
- `src/app/api/yield/positions/[id]/refresh/route.ts` — Compute yield from on-chain value minus cost basis
- `src/types/database.ts` — Add `yield_token_balance` to YieldPosition interface

---

### Task 1: DB Migration — Add yield_token_balance

**Files:**
- Create: `supabase/migrations/0029_yield_position_token_balance.sql`
- Modify: `src/types/database.ts:555-573`

- [ ] **Step 1: Create migration**

```sql
-- 0029_yield_position_token_balance.sql
-- Track yield token balance for on-chain verification and accounting

ALTER TABLE yield_positions
  ADD COLUMN yield_token_balance NUMERIC(36,18) NOT NULL DEFAULT 0;

COMMENT ON COLUMN yield_positions.yield_token_balance IS
  'Number of yield-bearing tokens held (aUSDC, sUSDe, vault shares, etc.)';
COMMENT ON COLUMN yield_positions.deposited_amount IS
  'Net cost basis in underlying token units. Adjusted proportionally on partial withdrawals.';
COMMENT ON COLUMN yield_positions.current_value_usd IS
  'Current USD value from most recent on-chain refresh. Do NOT set during deposit/withdraw.';
COMMENT ON COLUMN yield_positions.accrued_yield_usd IS
  'Computed as current_value_usd - deposited_amount. Updated on refresh only.';
```

- [ ] **Step 2: Apply migration to dev and prod**

```bash
# Dev
SQL=$(cat supabase/migrations/0029_yield_position_token_balance.sql) && \
curl -s -X POST "https://api.supabase.com/v1/projects/spllxotyxipdvfpkkvgu/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$SQL")}"

# Prod
SQL=$(cat supabase/migrations/0029_yield_position_token_balance.sql) && \
curl -s -X POST "https://api.supabase.com/v1/projects/lfujbwemavgiifkltrag/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(python3 -c "import json,sys; print(json.dumps(sys.stdin.read()))" <<< "$SQL")}"
```

- [ ] **Step 3: Update TypeScript type**

In `src/types/database.ts`, add `yield_token_balance` to the `YieldPosition` interface:

```typescript
export interface YieldPosition {
  id: string;
  user_id: string;
  enterprise_id: string | null;
  wallet_id: string | null;
  protocol: YieldProtocolId;
  chain: ChainType;
  underlying_token: TokenSymbol;
  yield_token: string;
  deposited_amount: string;       // net cost basis
  yield_token_balance: string;    // yield token units held
  current_value_usd: string;     // from on-chain refresh
  accrued_yield_usd: string;     // current_value - deposited_amount
  apy_snapshot: string | null;
  last_refreshed_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0029_yield_position_token_balance.sql src/types/database.ts
git commit -m "feat: add yield_token_balance column, document cost basis semantics"
```

---

### Task 2: Position Accounting Logic

**Files:**
- Create: `src/lib/yield/position-accounting.ts`

- [ ] **Step 1: Create the accounting module**

```typescript
/**
 * Average cost basis accounting for yield positions.
 *
 * The blockchain is the source of truth for current value.
 * Our DB is the source of truth for cost basis (what was put in net of withdrawals).
 * Yield = current value - cost basis.
 */

export interface CostBasisUpdate {
  newDepositedAmount: number;
  newYieldTokenBalance: number;
}

/**
 * Adjust cost basis after a deposit.
 * Simply adds the new deposit to existing cost basis.
 */
export function applyDeposit(
  currentDeposited: number,
  currentTokenBalance: number,
  depositAmount: number,
  tokensReceived: number,
): CostBasisUpdate {
  return {
    newDepositedAmount: currentDeposited + depositAmount,
    newYieldTokenBalance: currentTokenBalance + tokensReceived,
  };
}

/**
 * Adjust cost basis after a partial or full withdrawal.
 * Uses average cost basis: reduces deposited_amount proportionally
 * to the fraction of total value being withdrawn.
 *
 * Example: position worth $160k (deposited $150k, yield $10k), withdraw $30k
 *   withdrawFraction = 30000 / 160000 = 0.1875
 *   newDeposited = 150000 * (1 - 0.1875) = 121875
 *   realizedYield = 30000 - (150000 * 0.1875) = 30000 - 28125 = 1875
 */
export function applyWithdrawal(
  currentDeposited: number,
  currentTokenBalance: number,
  currentValueUsd: number,
  withdrawAmountUsd: number,
  tokensRedeemed: number,
): CostBasisUpdate & { realizedYield: number; isFullWithdrawal: boolean } {
  const isFullWithdrawal = tokensRedeemed >= currentTokenBalance || withdrawAmountUsd >= currentValueUsd;

  if (isFullWithdrawal) {
    const realizedYield = currentValueUsd - currentDeposited;
    return {
      newDepositedAmount: 0,
      newYieldTokenBalance: 0,
      realizedYield: Math.max(0, realizedYield),
      isFullWithdrawal: true,
    };
  }

  const withdrawFraction = withdrawAmountUsd / currentValueUsd;
  const costBasisReduction = currentDeposited * withdrawFraction;
  const realizedYield = withdrawAmountUsd - costBasisReduction;

  return {
    newDepositedAmount: currentDeposited * (1 - withdrawFraction),
    newYieldTokenBalance: currentTokenBalance - tokensRedeemed,
    realizedYield: Math.max(0, realizedYield),
    isFullWithdrawal: false,
  };
}

/**
 * Compute accrued yield from current on-chain value and cost basis.
 * Called during position refresh.
 */
export function computeAccruedYield(
  currentValueUsd: number,
  depositedAmount: number,
): number {
  return Math.max(0, currentValueUsd - depositedAmount);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/position-accounting.ts
git commit -m "feat: add average cost basis accounting for yield positions"
```

---

### Task 3: Update Interface — Add getOnChainValue

**Files:**
- Modify: `src/lib/yield/interface.ts:90-108`

- [ ] **Step 1: Add OnChainValue type and update IYieldProtocol**

Add after the `PositionInfo` interface (line 100):

```typescript
export interface OnChainValue {
  currentValueUsd: number;
  yieldTokenBalance: number;
}
```

Update `IYieldProtocol` to add `getOnChainValue`:

```typescript
export interface IYieldProtocol {
  getInfo(): YieldProtocolInfo;
  getAPY(token: TokenSymbol): Promise<YieldRate>;
  getPosition(walletAddress: string, token: TokenSymbol): Promise<PositionInfo | null>;
  getOnChainValue(walletAddress: string, token: TokenSymbol, yieldToken: string): Promise<OnChainValue>;
  deposit(params: DepositParams): Promise<DepositResult>;
  withdraw(params: WithdrawParams): Promise<WithdrawResult>;
}
```

- [ ] **Step 2: Update DepositResult to include tokensReceived**

```typescript
export interface DepositResult {
  txHash: string | null;
  providerRef?: string;
  yieldToken: string;
  yieldTokenAmount: string;  // already exists
  tokensReceived: number;    // add: actual yield tokens received
  estimatedAPY: number;
}
```

- [ ] **Step 3: Update WithdrawResult to include tokensRedeemed**

```typescript
export interface WithdrawResult {
  txHash: string | null;
  providerRef?: string;
  receivedAmount: string;
  tokensRedeemed: number;    // add: actual yield tokens redeemed
  fee?: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/yield/interface.ts
git commit -m "feat: add getOnChainValue, tokensReceived/Redeemed to yield interface"
```

---

### Task 4: Fix Mock Adapter Accounting

**Files:**
- Modify: `src/lib/yield/mock/yield-mock.ts`

- [ ] **Step 1: Update MockYieldAdapter to implement new interface and fix accounting**

Update the `deposit` method to not reset `current_value_usd`, return `tokensReceived`, and track yield token balance:

```typescript
async deposit(params: DepositParams): Promise<DepositResult> {
  await new Promise((r) => setTimeout(r, 300));
  const apys = MOCK_APYS[this.protocol];
  const yieldToken = YIELD_TOKENS[this.protocol];
  const amount = parseFloat(params.amount);

  const key = posKey(this.protocol, params.walletAddress, params.token);
  const existing = mockPositions.get(key);
  const newDeposited = (existing ? parseFloat(existing.depositedAmount) : 0) + amount;
  const newTokenBalance = (existing?.metadata?.tokenBalance as number ?? 0) + amount;

  mockPositions.set(key, {
    protocol: this.protocol,
    chain: params.chain,
    underlyingToken: params.token,
    yieldToken,
    depositedAmount: newDeposited.toString(),
    currentValueUsd: existing ? existing.currentValueUsd + amount : amount,
    accruedYieldUsd: existing?.accruedYieldUsd ?? 0,
    currentAPY: apys.supply + apys.reward,
    metadata: { tokenBalance: newTokenBalance },
  });

  const needsProviderRef = ['ondo', 'maple'].includes(this.protocol);
  return {
    txHash: needsProviderRef ? null : `0xmock_${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    providerRef: needsProviderRef ? `${this.protocol.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}` : undefined,
    yieldToken,
    yieldTokenAmount: params.amount,
    tokensReceived: amount,
    estimatedAPY: apys.supply + apys.reward,
  };
}
```

Update `withdraw` to use proportional cost basis:

```typescript
async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
  await new Promise((r) => setTimeout(r, 300));
  const amount = parseFloat(params.amount);

  const key = posKey(this.protocol, params.walletAddress, params.token);
  const existing = mockPositions.get(key);
  let tokensRedeemed = amount;

  if (existing) {
    const currentValue = existing.currentValueUsd;
    const isFullWithdrawal = amount >= currentValue;

    if (isFullWithdrawal) {
      tokensRedeemed = existing.metadata?.tokenBalance as number ?? amount;
      mockPositions.delete(key);
    } else {
      const withdrawFraction = amount / currentValue;
      const currentTokenBalance = existing.metadata?.tokenBalance as number ?? parseFloat(existing.depositedAmount);
      tokensRedeemed = currentTokenBalance * withdrawFraction;
      const newDeposited = parseFloat(existing.depositedAmount) * (1 - withdrawFraction);
      const newTokenBalance = currentTokenBalance - tokensRedeemed;

      mockPositions.set(key, {
        ...existing,
        depositedAmount: newDeposited.toString(),
        currentValueUsd: currentValue - amount,
        accruedYieldUsd: (currentValue - amount) - newDeposited,
        metadata: { tokenBalance: newTokenBalance },
      });
    }
  }

  const needsProviderRef = ['ondo', 'maple'].includes(this.protocol);
  return {
    txHash: needsProviderRef ? null : `0xmock_${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    providerRef: needsProviderRef ? `${this.protocol.toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}` : undefined,
    receivedAmount: params.amount,
    tokensRedeemed,
  };
}
```

Add `getOnChainValue`:

```typescript
async getOnChainValue(walletAddress: string, token: TokenSymbol, _yieldToken: string): Promise<OnChainValue> {
  const key = posKey(this.protocol, walletAddress, token);
  const pos = mockPositions.get(key);
  if (!pos) return { currentValueUsd: 0, yieldTokenBalance: 0 };

  // Mock: simulate small yield accrual (0.01% per refresh)
  const simYield = pos.currentValueUsd * 0.0001;
  const newValue = pos.currentValueUsd + simYield;
  const tokenBalance = pos.metadata?.tokenBalance as number ?? parseFloat(pos.depositedAmount);

  // Update stored mock position with simulated growth
  mockPositions.set(key, {
    ...pos,
    currentValueUsd: newValue,
    accruedYieldUsd: newValue - parseFloat(pos.depositedAmount),
  });

  return { currentValueUsd: newValue, yieldTokenBalance: tokenBalance };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/mock/yield-mock.ts
git commit -m "fix: mock adapter accounting — proportional cost basis, yield token tracking"
```

---

### Task 5: Fix Deposit API Route

**Files:**
- Modify: `src/app/api/yield/deposit/route.ts:83-130`

- [ ] **Step 1: Update deposit position logic**

Replace the position upsert block (lines 83–130) with:

```typescript
    // Upsert position — DO NOT reset current_value_usd
    const { data: existingPos } = await supabase
      .from('yield_positions')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('enterprise_id', enterpriseId)
      .eq('protocol', protocol)
      .eq('underlying_token', token)
      .eq('is_active', true)
      .maybeSingle();

    let positionId: string;

    if (existingPos) {
      const newDeposited = parseFloat(existingPos.deposited_amount) + parseFloat(amount);
      const newTokenBalance = parseFloat(existingPos.yield_token_balance || '0') + result.tokensReceived;
      // Add deposit to current_value, don't reset it (preserves accrued yield)
      const newCurrentValue = parseFloat(existingPos.current_value_usd) + parseFloat(amount);
      const { data: updated } = await supabase
        .from('yield_positions')
        .update({
          deposited_amount: newDeposited,
          yield_token_balance: newTokenBalance,
          current_value_usd: newCurrentValue,
          accrued_yield_usd: Math.max(0, newCurrentValue - newDeposited),
          apy_snapshot: result.estimatedAPY,
          last_refreshed_at: new Date().toISOString(),
        })
        .eq('id', existingPos.id)
        .select()
        .single();
      positionId = existingPos.id;
    } else {
      const { data: newPos, error: posErr } = await supabase
        .from('yield_positions')
        .insert({
          user_id: session.user.id,
          enterprise_id: enterpriseId,
          wallet_id: wallet?.id ?? null,
          protocol,
          chain,
          underlying_token: token,
          yield_token: result.yieldToken,
          deposited_amount: parseFloat(amount),
          yield_token_balance: result.tokensReceived,
          current_value_usd: parseFloat(amount),
          accrued_yield_usd: 0,
          apy_snapshot: result.estimatedAPY,
          last_refreshed_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (posErr) throw new Error(posErr.message);
      positionId = newPos!.id;
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/yield/deposit/route.ts
git commit -m "fix: deposit route preserves accrued yield, tracks yield_token_balance"
```

---

### Task 6: Fix Withdraw API Route

**Files:**
- Modify: `src/app/api/yield/withdraw/route.ts:58,92-108`

- [ ] **Step 1: Import accounting module**

Add at top of file:

```typescript
import { applyWithdrawal } from '@/lib/yield/position-accounting';
```

- [ ] **Step 2: Fix withdrawal validation**

Replace line 58 (`if (parseFloat(amount) > parseFloat(position.deposited_amount))`) with:

```typescript
  // Validate against current value, not deposited amount
  // (user can withdraw yield too, not just principal)
  const currentValue = parseFloat(position.current_value_usd);
  if (parseFloat(amount) > currentValue) {
    return NextResponse.json({ error: 'Withdrawal amount exceeds position value' }, { status: 400 });
  }
```

- [ ] **Step 3: Fix position update after withdrawal**

Replace the position update block (lines 92–108) with:

```typescript
    const withdrawResult = applyWithdrawal(
      parseFloat(position.deposited_amount),
      parseFloat(position.yield_token_balance || '0'),
      parseFloat(position.current_value_usd),
      parseFloat(amount),
      result.tokensRedeemed,
    );

    if (withdrawResult.isFullWithdrawal) {
      await supabase
        .from('yield_positions')
        .update({
          is_active: false,
          deposited_amount: 0,
          yield_token_balance: 0,
          current_value_usd: 0,
          accrued_yield_usd: 0,
          metadata: {
            ...position.metadata,
            realized_yield_usd: withdrawResult.realizedYield,
            closed_at: new Date().toISOString(),
          },
        })
        .eq('id', positionId);
    } else {
      await supabase
        .from('yield_positions')
        .update({
          deposited_amount: withdrawResult.newDepositedAmount,
          yield_token_balance: withdrawResult.newYieldTokenBalance,
          current_value_usd: parseFloat(position.current_value_usd) - parseFloat(amount),
          accrued_yield_usd: Math.max(0,
            (parseFloat(position.current_value_usd) - parseFloat(amount)) - withdrawResult.newDepositedAmount
          ),
          last_refreshed_at: new Date().toISOString(),
        })
        .eq('id', positionId);
    }
```

- [ ] **Step 4: Add realized yield to transaction metadata**

In the transaction update (around line 114), add `realizedYield`:

```typescript
    await supabase
      .from('yield_transactions')
      .update({
        tx_hash: result.txHash,
        status: 'completed',
        executed_at: new Date().toISOString(),
        metadata: {
          providerRef: result.providerRef,
          receivedAmount: result.receivedAmount,
          realizedYield: withdrawResult.realizedYield,
          isFullWithdrawal: withdrawResult.isFullWithdrawal,
        },
      })
      .eq('id', tx.id);
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/yield/withdraw/route.ts
git commit -m "fix: withdraw uses proportional cost basis, tracks realized yield"
```

---

### Task 7: Fix Refresh Route — Compute Yield from On-Chain

**Files:**
- Modify: `src/app/api/yield/positions/[id]/refresh/route.ts:52-61`

- [ ] **Step 1: Import accounting module**

Add at top:

```typescript
import { computeAccruedYield } from '@/lib/yield/position-accounting';
```

- [ ] **Step 2: Replace the refresh logic**

Replace lines 52–61 with:

```typescript
  const adapter = getYieldAdapter(position.protocol as YieldProtocolId);
  const rate = await adapter.getAPY(position.underlying_token as TokenSymbol);

  // Get current on-chain value
  const onChain = await adapter.getOnChainValue(
    walletAddress,
    position.underlying_token as TokenSymbol,
    position.yield_token,
  );

  const currentValue = onChain.currentValueUsd;
  const depositedAmount = parseFloat(position.deposited_amount);
  const accruedYield = computeAccruedYield(currentValue, depositedAmount);

  const updatedFields = {
    current_value_usd: currentValue,
    accrued_yield_usd: accruedYield,
    yield_token_balance: onChain.yieldTokenBalance,
    apy_snapshot: rate.totalAPY,
    last_refreshed_at: new Date().toISOString(),
  };
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/yield/positions/[id]/refresh/route.ts
git commit -m "fix: refresh computes yield from on-chain value minus cost basis"
```

---

### Task 8: Contract Constants & ABIs

**Files:**
- Create: `src/lib/yield/adapters/constants.ts`

- [ ] **Step 1: Create shared constants file**

```typescript
// ─── Ethereum Token Addresses ─────────────────────────────────────
export const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;
export const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const;

// ─── Aave V3 ──────────────────────────────────────────────────────
export const AAVE_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const;
export const AAVE_AUSDC = '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c' as const;
export const AAVE_AUSDT = '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a' as const;

// ─── Compound V3 ──────────────────────────────────────────────────
export const COMPOUND_COMET_USDC = '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as const;
export const COMPOUND_COMET_USDT = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840' as const;

// ─── Morpho ───────────────────────────────────────────────────────
export const MORPHO_STEAKHOUSE_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB' as const;

// ─── Sky (sUSDS) ──────────────────────────────────────────────────
export const SKY_SUSDS = '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD' as const;

// ─── Ethena (sUSDe) ───────────────────────────────────────────────
export const ETHENA_SUSDE = '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497' as const;

// ─── Ondo (USDY) ──────────────────────────────────────────────────
export const ONDO_USDY = '0x96F6eF951840721AdBF46Ac996b59E0235CB985C' as const;
export const ONDO_ORACLE = '0xA0a2d7C842EcB40D4430993104E45FA8E4DBc2e5' as const;

// ─── Shared ABIs ──────────────────────────────────────────────────
export const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const ERC4626_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const COMPOUND_COMET_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/adapters/constants.ts
git commit -m "feat: add contract addresses and ABIs for yield adapters"
```

---

### Task 9: Live Aave V3 Adapter

**Files:**
- Create: `src/lib/yield/adapters/aave-v3.ts`

- [ ] **Step 1: Create the adapter**

```typescript
import { ethereumClient } from '../rates/client';
import { AAVE_AUSDC, AAVE_AUSDT, ERC20_BALANCE_ABI, USDC_ADDRESS, USDT_ADDRESS } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const ATOKEN_MAP: Record<string, `0x${string}`> = {
  USDC: AAVE_AUSDC,
  USDT: AAVE_AUSDT,
};

// aTokens use 6 decimals (same as underlying USDC/USDT)
const DECIMALS = 6;

/**
 * Aave V3: aTokens are rebasing — balanceOf() returns the current value
 * including all accrued interest. No exchange rate needed.
 */
export async function getAaveOnChainValue(
  walletAddress: string,
  token: TokenSymbol,
): Promise<OnChainValue> {
  const aTokenAddress = ATOKEN_MAP[token];
  if (!aTokenAddress) {
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }

  const balance = await ethereumClient.readContract({
    address: aTokenAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;

  return {
    currentValueUsd: balanceFloat, // stablecoin ≈ $1
    yieldTokenBalance: balanceFloat,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/adapters/aave-v3.ts
git commit -m "feat: live Aave V3 on-chain position adapter"
```

---

### Task 10: Live Compound V3 Adapter

**Files:**
- Create: `src/lib/yield/adapters/compound-v3.ts`

- [ ] **Step 1: Create the adapter**

```typescript
import { ethereumClient } from '../rates/client';
import { COMPOUND_COMET_USDC, COMPOUND_COMET_USDT, COMPOUND_COMET_ABI } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const COMET_MAP: Record<string, `0x${string}`> = {
  USDC: COMPOUND_COMET_USDC,
  USDT: COMPOUND_COMET_USDT,
};

const DECIMALS = 6;

/**
 * Compound V3: balanceOf() on the Comet contract returns the current
 * supply balance including accrued interest.
 */
export async function getCompoundOnChainValue(
  walletAddress: string,
  token: TokenSymbol,
): Promise<OnChainValue> {
  const cometAddress = COMET_MAP[token];
  if (!cometAddress) {
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }

  const balance = await ethereumClient.readContract({
    address: cometAddress,
    abi: COMPOUND_COMET_ABI,
    functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;

  return {
    currentValueUsd: balanceFloat,
    yieldTokenBalance: balanceFloat,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/adapters/compound-v3.ts
git commit -m "feat: live Compound V3 on-chain position adapter"
```

---

### Task 11: Live ERC-4626 Vault Adapters (Morpho, Sky, Ethena)

**Files:**
- Create: `src/lib/yield/adapters/erc4626.ts`

- [ ] **Step 1: Create shared ERC-4626 adapter**

Morpho Steakhouse, Sky sUSDS, and Ethena sUSDe all follow the ERC-4626 vault standard: `balanceOf()` for shares, `convertToAssets()` for current value.

```typescript
import { ethereumClient } from '../rates/client';
import { ERC4626_ABI, MORPHO_STEAKHOUSE_VAULT, SKY_SUSDS, ETHENA_SUSDE } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';
import type { YieldProtocolId } from '../interface';

interface VaultConfig {
  address: `0x${string}`;
  shareDecimals: number;
  assetDecimals: number;
}

const VAULT_MAP: Partial<Record<YieldProtocolId, VaultConfig>> = {
  morpho_steakhouse: { address: MORPHO_STEAKHOUSE_VAULT, shareDecimals: 18, assetDecimals: 6 },
  sky: { address: SKY_SUSDS, shareDecimals: 18, assetDecimals: 18 },
  ethena: { address: ETHENA_SUSDE, shareDecimals: 18, assetDecimals: 18 },
};

/**
 * ERC-4626 vaults: balanceOf() returns shares held,
 * convertToAssets(shares) returns the current underlying value.
 */
export async function getErc4626OnChainValue(
  protocol: YieldProtocolId,
  walletAddress: string,
  _token: TokenSymbol,
): Promise<OnChainValue> {
  const config = VAULT_MAP[protocol];
  if (!config) {
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }

  const shares = await ethereumClient.readContract({
    address: config.address,
    abi: ERC4626_ABI,
    functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  if (shares === 0n) {
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }

  const assets = await ethereumClient.readContract({
    address: config.address,
    abi: ERC4626_ABI,
    functionName: 'convertToAssets',
    args: [shares],
  });

  const sharesFloat = Number(shares) / 10 ** config.shareDecimals;
  const assetsFloat = Number(assets) / 10 ** config.assetDecimals;

  return {
    currentValueUsd: assetsFloat, // stablecoin-denominated ≈ USD
    yieldTokenBalance: sharesFloat,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/adapters/erc4626.ts
git commit -m "feat: live ERC-4626 adapter for Morpho Steakhouse, Sky sUSDS, Ethena sUSDe"
```

---

### Task 12: Live Ondo USDY Adapter

**Files:**
- Create: `src/lib/yield/adapters/ondo.ts`

- [ ] **Step 1: Create the adapter**

```typescript
import { ethereumClient } from '../rates/client';
import { ONDO_USDY, ERC20_BALANCE_ABI } from './constants';
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

const DECIMALS = 18;

// Ondo USDY oracle price ABI
const ORACLE_ABI = [
  {
    name: 'getLatestPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Ondo USDY: token balance stays constant, but the oracle price
 * increases daily reflecting accrued yield. Value = balance × price.
 * USDY price starts at ~$1.00 and increases (e.g. $1.04 after a year at 4%).
 * If no oracle is available, approximate USDY ≈ $1.00.
 */
export async function getOndoOnChainValue(
  walletAddress: string,
  _token: TokenSymbol,
): Promise<OnChainValue> {
  const balance = await ethereumClient.readContract({
    address: ONDO_USDY,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: [walletAddress as `0x${string}`],
  });

  const balanceFloat = Number(balance) / 10 ** DECIMALS;

  // USDY accrues value through price appreciation
  // For now, use 1:1 approximation — enhance with oracle when available
  const usdyPrice = 1.0;

  return {
    currentValueUsd: balanceFloat * usdyPrice,
    yieldTokenBalance: balanceFloat,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/adapters/ondo.ts
git commit -m "feat: live Ondo USDY on-chain position adapter"
```

---

### Task 13: Solana Adapter Stubs (Kamino, Drift)

**Files:**
- Create: `src/lib/yield/adapters/kamino.ts`
- Create: `src/lib/yield/adapters/drift.ts`

- [ ] **Step 1: Create Kamino stub**

Kamino positions require parsing Solana account data which is more complex. For now, create a stub that falls back to the DB stored value and logs a warning.

```typescript
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

/**
 * Kamino (Solana): position tracking requires parsing kToken accounts
 * and vault share prices. Stubbed for now — returns stored DB value.
 * TODO: Implement with @solana/web3.js + Kamino SDK
 */
export async function getKaminoOnChainValue(
  _walletAddress: string,
  _token: TokenSymbol,
  storedValue: number,
  storedTokenBalance: number,
): Promise<OnChainValue> {
  console.warn('[yield/kamino] On-chain position query not yet implemented, using stored value');
  return {
    currentValueUsd: storedValue,
    yieldTokenBalance: storedTokenBalance,
  };
}
```

- [ ] **Step 2: Create Drift stub**

```typescript
import type { OnChainValue } from '../interface';
import type { TokenSymbol } from '@/types/database';

/**
 * Drift (Solana): lending position tracking requires parsing
 * Drift user account state. Stubbed for now — returns stored DB value.
 * TODO: Implement with @drift-labs/sdk
 */
export async function getDriftOnChainValue(
  _walletAddress: string,
  _token: TokenSymbol,
  storedValue: number,
  storedTokenBalance: number,
): Promise<OnChainValue> {
  console.warn('[yield/drift] On-chain position query not yet implemented, using stored value');
  return {
    currentValueUsd: storedValue,
    yieldTokenBalance: storedTokenBalance,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/yield/adapters/kamino.ts src/lib/yield/adapters/drift.ts
git commit -m "feat: stub Solana yield adapters (Kamino, Drift) for future implementation"
```

---

### Task 14: Wire Up Factory to Live Adapters

**Files:**
- Modify: `src/lib/yield/factory.ts`

- [ ] **Step 1: Update factory to route based on integration mode**

```typescript
import type { IYieldProtocol, YieldProtocolId, OnChainValue } from './interface';
import type { TokenSymbol } from '@/types/database';
import { MockYieldAdapter } from './mock/yield-mock';
import { getAaveOnChainValue } from './adapters/aave-v3';
import { getCompoundOnChainValue } from './adapters/compound-v3';
import { getErc4626OnChainValue } from './adapters/erc4626';
import { getOndoOnChainValue } from './adapters/ondo';
import { getKaminoOnChainValue } from './adapters/kamino';
import { getDriftOnChainValue } from './adapters/drift';

export function getYieldAdapter(protocol: YieldProtocolId): IYieldProtocol {
  // All protocols still use the mock adapter for deposit/withdraw execution.
  // Real on-chain execution is a separate workstream.
  // getOnChainValue() is overridden to query real balances.
  return new MockYieldAdapter(protocol);
}

/**
 * Query on-chain value for a position. This is the live balance query
 * used during position refresh. Falls back to stored values on error.
 */
export async function getOnChainValue(
  protocol: YieldProtocolId,
  walletAddress: string,
  token: TokenSymbol,
  storedValue: number,
  storedTokenBalance: number,
): Promise<OnChainValue> {
  try {
    switch (protocol) {
      case 'aave_v3':
        return await getAaveOnChainValue(walletAddress, token);
      case 'compound_v3':
        return await getCompoundOnChainValue(walletAddress, token);
      case 'morpho_steakhouse':
      case 'sky':
      case 'ethena':
        return await getErc4626OnChainValue(protocol, walletAddress, token);
      case 'ondo':
        return await getOndoOnChainValue(walletAddress, token);
      case 'kamino':
      case 'kamino_multiply':
        return await getKaminoOnChainValue(walletAddress, token, storedValue, storedTokenBalance);
      case 'drift':
        return await getDriftOnChainValue(walletAddress, token, storedValue, storedTokenBalance);
      case 'morpho':
        // Morpho Blue direct lending — no standard vault, use stored value
        return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
      case 'maple':
        // Maple has custom pool contracts, use stored value for now
        return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
      default:
        return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
    }
  } catch (err) {
    console.error(`[yield/${protocol}] On-chain query failed, using stored value:`, err);
    return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
  }
}

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

- [ ] **Step 2: Update refresh route to use new factory function**

In `src/app/api/yield/positions/[id]/refresh/route.ts`, replace the `getOnChainValue` call from Task 7 to use the factory:

```typescript
import { getYieldAdapter, getOnChainValue } from '@/lib/yield/factory';
```

And update the call:

```typescript
  const onChain = await getOnChainValue(
    position.protocol as YieldProtocolId,
    walletAddress,
    position.underlying_token as TokenSymbol,
    parseFloat(position.current_value_usd),
    parseFloat(position.yield_token_balance || '0'),
  );
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/yield/factory.ts src/app/api/yield/positions/[id]/refresh/route.ts
git commit -m "feat: wire live on-chain adapters into factory with fallback"
```

---

### Task 15: Final Integration Test

- [ ] **Step 1: Verify build passes**

```bash
npx next build
```

- [ ] **Step 2: Test locally**

1. Start dev server: `npx next dev`
2. Log in, navigate to Yield page
3. Deposit into a position — verify `deposited_amount` increases, `current_value_usd` adds (not resets)
4. Refresh the position — verify `accrued_yield_usd` updates
5. Partial withdraw — verify `deposited_amount` decreases proportionally, not by the full withdrawal amount
6. Full withdraw — verify position is deactivated, `realized_yield_usd` in metadata

- [ ] **Step 3: Commit all remaining changes and push**

```bash
git add -A
git commit -m "feat: yield position accounting and live on-chain adapters

- Average cost basis accounting for deposits/withdrawals
- Proportional cost basis reduction on partial withdrawals
- Realized yield tracking on full withdrawals
- Live on-chain adapters for Aave V3, Compound V3, Morpho Steakhouse,
  Sky sUSDS, Ethena sUSDe, Ondo USDY
- Solana stubs for Kamino and Drift
- yield_token_balance column for on-chain verification
- Mock adapter fixed with simulated yield accrual"

git push origin master
git push origin master:dev
```

---

## Out of Scope (Future Work)

- **Real on-chain deposit/withdraw execution** — currently all protocols use mock adapter for tx execution. Real execution requires wallet signing integration (wagmi/wallet-adapter).
- **Solana position queries** — Kamino and Drift need SDK integration for on-chain balance reads.
- **Morpho Blue direct lending positions** — non-vault positions need market-specific queries.
- **Maple pool positions** — custom pool contract integration.
- **Automated position refresh cron** — periodic refresh of all active positions.
- **Ondo USDY oracle integration** — query real USDY price for precise valuation.
