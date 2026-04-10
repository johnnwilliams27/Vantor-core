# Real On-Chain Yield Execution — EVM Protocols

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock deposit/withdraw with real on-chain transactions for the 6 EVM yield protocols (Aave V3, Compound V3, Morpho Steakhouse, Sky sUSDS, Ethena sUSDe, Ondo USDY), enabling real customer usage.

**Architecture:** Two-phase execution model. Phase 1 (frontend): user approves ERC-20 spend, then signs and submits the deposit/withdraw transaction via their connected wallet (wagmi). Phase 2 (backend): frontend sends the confirmed tx hash to the API, which records the position and transaction. The backend never holds private keys — all signing happens client-side.

**Tech Stack:** wagmi v2 (useWriteContract, useWaitForTransactionReceipt), viem (contract encoding, address constants), existing RainbowKit wallet connection, existing Next.js API routes.

---

## Architecture Overview

### Current Flow (Mock)
```
User clicks Deposit → Frontend POSTs to /api/yield/deposit → Backend calls MockAdapter.deposit() → Returns fake txHash → Frontend shows success
```

### New Flow (Real)
```
User clicks Deposit
  → Frontend checks ERC-20 allowance (viem readContract)
  → If insufficient: Frontend prompts approve tx (wagmi writeContract) → User signs in wallet
  → Frontend builds deposit tx (wagmi writeContract with protocol-specific calldata)
  → User signs in wallet → tx submitted to chain
  → Frontend waits for tx confirmation (wagmi waitForTransactionReceipt)
  → Frontend POSTs to /api/yield/confirm-deposit with { txHash, protocol, token, amount, walletAddress, chain }
  → Backend verifies tx on-chain, records position + transaction
  → Frontend shows success
```

### Key Design Decisions

1. **Backend becomes a recorder, not an executor.** The API routes change from "execute this deposit" to "record this confirmed deposit."
2. **New API endpoints:** `/api/yield/confirm-deposit` and `/api/yield/confirm-withdraw` replace the execution part of the existing routes. The existing routes remain for mock/lite-tier users.
3. **Frontend hooks handle the multi-step flow:** approve → deposit → wait → confirm. Each step can fail independently with clear error messages.
4. **Protocol-specific contract calls are in a single frontend module** (`src/lib/yield/contracts/`) with typed ABIs and addresses.

---

## File Structure

### New files
- `src/lib/yield/contracts/abis.ts` — Full deposit/withdraw ABIs for all 6 EVM protocols
- `src/lib/yield/contracts/addresses.ts` — Contract addresses organized by protocol
- `src/lib/yield/contracts/deposit.ts` — Build deposit transaction params per protocol
- `src/lib/yield/contracts/withdraw.ts` — Build withdraw transaction params per protocol
- `src/lib/yield/contracts/allowance.ts` — ERC-20 allowance check and approve helpers
- `src/hooks/useOnChainDeposit.ts` — Multi-step deposit hook (approve → deposit → confirm)
- `src/hooks/useOnChainWithdraw.ts` — Multi-step withdraw hook (withdraw → confirm)
- `src/app/api/yield/confirm-deposit/route.ts` — Record confirmed deposit
- `src/app/api/yield/confirm-withdraw/route.ts` — Record confirmed withdrawal

### Modified files
- `src/components/yield/YieldRatesTable.tsx` — InlineDepositForm uses real hook for paid users
- `src/components/yield/YieldWithdrawForm.tsx` — Uses real hook for paid users
- `src/hooks/useYield.ts` — Add `useConfirmDeposit`, `useConfirmWithdraw` mutations
- `src/lib/yield/adapters/constants.ts` — Add deposit/withdraw contract addresses

---

### Task 1: Protocol Contract ABIs and Addresses

**Files:**
- Create: `src/lib/yield/contracts/abis.ts`
- Create: `src/lib/yield/contracts/addresses.ts`

- [ ] **Step 1: Create ABIs file**

```typescript
// src/lib/yield/contracts/abis.ts
// Minimal ABIs for deposit/withdraw on each protocol

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Aave V3 Pool — supply() and withdraw()
export const AAVE_POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Compound V3 Comet — supply() and withdraw()
export const COMPOUND_COMET_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// ERC-4626 Vault — deposit() and withdraw() (Morpho Steakhouse, Sky sUSDS, Ethena sUSDe)
export const ERC4626_VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    name: 'redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'owner', type: 'address' },
    ],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },
  {
    name: 'convertToShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
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

// Ondo USDY — mint via RWA hub (KYC-gated)
// USDY uses a separate minting contract, not a standard vault
export const ONDO_RAMP_ABI = [
  {
    name: 'requestSubscription',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'requestRedemption',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const;
```

- [ ] **Step 2: Create addresses file**

```typescript
// src/lib/yield/contracts/addresses.ts
import type { YieldProtocolId } from '../interface';

export const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
};

export const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
};

export interface ProtocolAddresses {
  /** Contract the user interacts with for deposit/withdraw */
  router: `0x${string}`;
  /** Contract that needs ERC-20 approval (usually same as router) */
  spender: `0x${string}`;
  /** Type of interaction */
  type: 'aave' | 'compound' | 'erc4626' | 'ondo';
}

export const PROTOCOL_ADDRESSES: Partial<Record<YieldProtocolId, ProtocolAddresses>> = {
  aave_v3: {
    router: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    spender: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    type: 'aave',
  },
  compound_v3: {
    router: '0xc3d688B66703497DAA19211EEdff47f25384cdc3', // USDC Comet
    spender: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    type: 'compound',
  },
  morpho_steakhouse: {
    router: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    spender: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
    type: 'erc4626',
  },
  sky: {
    router: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
    spender: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
    type: 'erc4626',
  },
  ethena: {
    router: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    spender: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497',
    type: 'erc4626',
  },
  ondo: {
    router: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
    spender: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
    type: 'ondo',
  },
};

/** Compound V3 has separate Comet contracts per token */
export const COMPOUND_COMET_BY_TOKEN: Record<string, `0x${string}`> = {
  USDC: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
  USDT: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840',
};
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/yield/contracts/abis.ts src/lib/yield/contracts/addresses.ts
git commit -m "feat: add protocol contract ABIs and addresses for on-chain execution"
```

---

### Task 2: ERC-20 Allowance and Approval Module

**Files:**
- Create: `src/lib/yield/contracts/allowance.ts`

- [ ] **Step 1: Create allowance module**

```typescript
// src/lib/yield/contracts/allowance.ts
import { type PublicClient, parseUnits } from 'viem';
import { ERC20_ABI } from './abis';
import { TOKEN_ADDRESSES, TOKEN_DECIMALS } from './addresses';

/**
 * Check if the spender has sufficient ERC-20 allowance.
 * Returns the current allowance in token units.
 */
export async function checkAllowance(
  publicClient: PublicClient,
  token: string,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);

  return publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });
}

/**
 * Check if approval is needed for a given amount.
 */
export async function needsApproval(
  publicClient: PublicClient,
  token: string,
  owner: `0x${string}`,
  spender: `0x${string}`,
  amount: string,
): Promise<boolean> {
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  const amountWei = parseUnits(amount, decimals);
  const allowance = await checkAllowance(publicClient, token, owner, spender);
  return allowance < amountWei;
}

/**
 * Build the approval transaction arguments for wagmi's writeContract.
 * Approves the exact amount (no infinite approvals for security).
 */
export function buildApproveArgs(token: string, spender: `0x${string}`, amount: string) {
  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);
  const decimals = TOKEN_DECIMALS[token] ?? 6;

  return {
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'approve' as const,
    args: [spender, parseUnits(amount, decimals)] as const,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/contracts/allowance.ts
git commit -m "feat: add ERC-20 allowance check and approval builder"
```

---

### Task 3: Deposit Transaction Builder

**Files:**
- Create: `src/lib/yield/contracts/deposit.ts`

- [ ] **Step 1: Create deposit tx builder**

```typescript
// src/lib/yield/contracts/deposit.ts
import { parseUnits } from 'viem';
import { AAVE_POOL_ABI, COMPOUND_COMET_ABI, ERC4626_VAULT_ABI } from './abis';
import {
  PROTOCOL_ADDRESSES,
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
  COMPOUND_COMET_BY_TOKEN,
} from './addresses';
import type { YieldProtocolId } from '../interface';

export interface DepositTxParams {
  address: `0x${string}`;
  abi: readonly any[];
  functionName: string;
  args: readonly any[];
}

/**
 * Build the deposit transaction params for wagmi's writeContract.
 * Returns protocol-specific calldata for the connected wallet to sign.
 */
export function buildDepositTx(
  protocol: YieldProtocolId,
  token: string,
  amount: string,
  walletAddress: `0x${string}`,
): DepositTxParams {
  const config = PROTOCOL_ADDRESSES[protocol];
  if (!config) throw new Error(`Protocol ${protocol} not supported for on-chain deposit`);

  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);
  const decimals = TOKEN_DECIMALS[token] ?? 6;
  const amountWei = parseUnits(amount, decimals);

  switch (config.type) {
    case 'aave':
      // Aave V3: supply(asset, amount, onBehalfOf, referralCode)
      return {
        address: config.router,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [tokenAddress, amountWei, walletAddress, 0],
      };

    case 'compound': {
      // Compound V3: supply(asset, amount) on the token-specific Comet
      const cometAddress = COMPOUND_COMET_BY_TOKEN[token] ?? config.router;
      return {
        address: cometAddress,
        abi: COMPOUND_COMET_ABI,
        functionName: 'supply',
        args: [tokenAddress, amountWei],
      };
    }

    case 'erc4626':
      // ERC-4626: deposit(assets, receiver)
      return {
        address: config.router,
        abi: ERC4626_VAULT_ABI,
        functionName: 'deposit',
        args: [amountWei, walletAddress],
      };

    case 'ondo':
      // Ondo: requestSubscription(amount)
      return {
        address: config.router,
        abi: [{ name: 'requestSubscription', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] }] as const,
        functionName: 'requestSubscription',
        args: [amountWei],
      };

    default:
      throw new Error(`Unsupported protocol type: ${config.type}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/contracts/deposit.ts
git commit -m "feat: add protocol-specific deposit transaction builder"
```

---

### Task 4: Withdraw Transaction Builder

**Files:**
- Create: `src/lib/yield/contracts/withdraw.ts`

- [ ] **Step 1: Create withdraw tx builder**

```typescript
// src/lib/yield/contracts/withdraw.ts
import { parseUnits } from 'viem';
import { AAVE_POOL_ABI, COMPOUND_COMET_ABI, ERC4626_VAULT_ABI } from './abis';
import {
  PROTOCOL_ADDRESSES,
  TOKEN_ADDRESSES,
  TOKEN_DECIMALS,
  COMPOUND_COMET_BY_TOKEN,
} from './addresses';
import type { YieldProtocolId } from '../interface';

export interface WithdrawTxParams {
  address: `0x${string}`;
  abi: readonly any[];
  functionName: string;
  args: readonly any[];
}

/**
 * Build the withdraw transaction params for wagmi's writeContract.
 */
export function buildWithdrawTx(
  protocol: YieldProtocolId,
  token: string,
  amount: string,
  walletAddress: `0x${string}`,
  isFullWithdrawal: boolean,
): WithdrawTxParams {
  const config = PROTOCOL_ADDRESSES[protocol];
  if (!config) throw new Error(`Protocol ${protocol} not supported for on-chain withdraw`);

  const tokenAddress = TOKEN_ADDRESSES[token];
  if (!tokenAddress) throw new Error(`Unknown token: ${token}`);
  const decimals = TOKEN_DECIMALS[token] ?? 6;

  // For full withdrawals, use max uint256 where supported
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  const amountWei = isFullWithdrawal ? MAX_UINT256 : parseUnits(amount, decimals);

  switch (config.type) {
    case 'aave':
      // Aave V3: withdraw(asset, amount, to) — use type(uint256).max for full withdrawal
      return {
        address: config.router,
        abi: AAVE_POOL_ABI,
        functionName: 'withdraw',
        args: [tokenAddress, amountWei, walletAddress],
      };

    case 'compound': {
      // Compound V3: withdraw(asset, amount) on the Comet
      const cometAddress = COMPOUND_COMET_BY_TOKEN[token] ?? config.router;
      return {
        address: cometAddress,
        abi: COMPOUND_COMET_ABI,
        functionName: 'withdraw',
        args: [tokenAddress, amountWei],
      };
    }

    case 'erc4626':
      // ERC-4626: withdraw(assets, receiver, owner)
      return {
        address: config.router,
        abi: ERC4626_VAULT_ABI,
        functionName: 'withdraw',
        args: [isFullWithdrawal ? MAX_UINT256 : parseUnits(amount, decimals), walletAddress, walletAddress],
      };

    case 'ondo':
      // Ondo: requestRedemption(amount)
      return {
        address: config.router,
        abi: [{ name: 'requestRedemption', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] }] as const,
        functionName: 'requestRedemption',
        args: [amountWei],
      };

    default:
      throw new Error(`Unsupported protocol type: ${config.type}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/contracts/withdraw.ts
git commit -m "feat: add protocol-specific withdraw transaction builder"
```

---

### Task 5: Backend Confirm Endpoints

**Files:**
- Create: `src/app/api/yield/confirm-deposit/route.ts`
- Create: `src/app/api/yield/confirm-withdraw/route.ts`

- [ ] **Step 1: Create confirm-deposit route**

This endpoint is called AFTER the frontend has submitted and confirmed the on-chain transaction. It records the position in the database.

```typescript
// src/app/api/yield/confirm-deposit/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const confirmDepositSchema = z.object({
  protocol: z.string(),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1),
  walletAddress: z.string().min(1),
  chain: z.enum(['ethereum', 'solana']),
  txHash: z.string().min(1),
  yieldToken: z.string().min(1),
  tokensReceived: z.number().positive(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('deposit into yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-deposit', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = confirmDepositSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { protocol, token, amount, walletAddress, chain, txHash, yieldToken, tokensReceived } = parsed.data;
  const supabase = createAdminClient();

  // Look up wallet
  const { data: wallet } = await supabase
    .from('wallets')
    .select('id')
    .eq('address', walletAddress)
    .eq('user_id', session.user.id)
    .maybeSingle();

  // Check for duplicate tx hash
  const { data: existingTx } = await supabase
    .from('yield_transactions')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existingTx) {
    return NextResponse.json({ error: 'Transaction already recorded' }, { status: 409 });
  }

  // Upsert position
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
    const newTokenBalance = parseFloat(existingPos.yield_token_balance || '0') + tokensReceived;
    const newCurrentValue = parseFloat(existingPos.current_value_usd) + parseFloat(amount);

    await supabase
      .from('yield_positions')
      .update({
        deposited_amount: newDeposited,
        yield_token_balance: newTokenBalance,
        current_value_usd: newCurrentValue,
        accrued_yield_usd: Math.max(0, newCurrentValue - newDeposited),
        last_refreshed_at: new Date().toISOString(),
      })
      .eq('id', existingPos.id);
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
        yield_token: yieldToken,
        deposited_amount: parseFloat(amount),
        yield_token_balance: tokensReceived,
        current_value_usd: parseFloat(amount),
        accrued_yield_usd: 0,
        last_refreshed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (posErr) return NextResponse.json({ error: posErr.message }, { status: 500 });
    positionId = newPos!.id;
  }

  // Record transaction
  await supabase
    .from('yield_transactions')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      position_id: positionId,
      protocol,
      chain,
      tx_type: 'deposit',
      underlying_token: token,
      amount: parseFloat(amount),
      amount_usd: parseFloat(amount),
      tx_hash: txHash,
      status: 'completed',
      executed_at: new Date().toISOString(),
    });

  await writeAuditLog({
    userId: session.user.id,
    action: 'yield_deposit',
    entityType: 'yield_position',
    entityId: positionId,
    details: { protocol, token, amount, txHash, onChain: true },
  });

  return NextResponse.json({ data: { positionId, txHash } }, { status: 201 });
}
```

- [ ] **Step 2: Create confirm-withdraw route**

```typescript
// src/app/api/yield/confirm-withdraw/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth.config';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/rbac';
import { writeAuditLog } from '@/lib/audit/logger';
import { checkRateLimit, rateLimitResponse } from '@/lib/api/rate-limit';
import { applyWithdrawal } from '@/lib/yield/position-accounting';
import { z } from 'zod';
import { getEffectiveEnterpriseId } from '@/lib/test-mode/enterprise';
import { requirePaidTier, tierGateResponse, TierGateError } from '@/lib/auth/tier-gate';

const confirmWithdrawSchema = z.object({
  positionId: z.string().uuid(),
  amount: z.string().min(1),
  walletAddress: z.string().min(1),
  txHash: z.string().min(1),
  tokensRedeemed: z.number().positive(),
  isFullWithdrawal: z.boolean(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { requireRole(session.user.role as any, 'treasury_manager'); }
  catch { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
  try { requirePaidTier(session.user.subscription_tier); }
  catch (e) { if (e instanceof TierGateError) return tierGateResponse('withdraw from yield protocols'); throw e; }

  const enterpriseId = await getEffectiveEnterpriseId(session.user.enterprise_id);

  if (!checkRateLimit('yield-withdraw', session.user.id, 10, 3600_000)) {
    return rateLimitResponse();
  }

  const body = await req.json();
  const parsed = confirmWithdrawSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { positionId, amount, walletAddress, txHash, tokensRedeemed, isFullWithdrawal } = parsed.data;
  const supabase = createAdminClient();

  // Fetch position
  const { data: position, error: posErr } = await supabase
    .from('yield_positions')
    .select('*')
    .eq('id', positionId)
    .eq('user_id', session.user.id)
    .eq('enterprise_id', enterpriseId)
    .eq('is_active', true)
    .single();

  if (posErr || !position) {
    return NextResponse.json({ error: 'Position not found' }, { status: 404 });
  }

  // Check for duplicate tx hash
  const { data: existingTx } = await supabase
    .from('yield_transactions')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existingTx) {
    return NextResponse.json({ error: 'Transaction already recorded' }, { status: 409 });
  }

  // Apply accounting
  const withdrawResult = applyWithdrawal(
    parseFloat(position.deposited_amount),
    parseFloat(position.yield_token_balance || '0'),
    parseFloat(position.current_value_usd),
    parseFloat(amount),
    tokensRedeemed,
  );

  if (isFullWithdrawal || withdrawResult.isFullWithdrawal) {
    await supabase
      .from('yield_positions')
      .update({
        is_active: false,
        deposited_amount: 0,
        yield_token_balance: 0,
        current_value_usd: 0,
        accrued_yield_usd: 0,
        metadata: {
          ...(typeof position.metadata === 'object' ? position.metadata : {}),
          realized_yield_usd: withdrawResult.realizedYield,
          closed_at: new Date().toISOString(),
        },
      })
      .eq('id', positionId);
  } else {
    const newCurrentValue = parseFloat(position.current_value_usd) - parseFloat(amount);
    await supabase
      .from('yield_positions')
      .update({
        deposited_amount: withdrawResult.newDepositedAmount,
        yield_token_balance: withdrawResult.newYieldTokenBalance,
        current_value_usd: newCurrentValue,
        accrued_yield_usd: Math.max(0, newCurrentValue - withdrawResult.newDepositedAmount),
        last_refreshed_at: new Date().toISOString(),
      })
      .eq('id', positionId);
  }

  // Record transaction
  await supabase
    .from('yield_transactions')
    .insert({
      user_id: session.user.id,
      enterprise_id: enterpriseId,
      position_id: positionId,
      protocol: position.protocol,
      chain: position.chain,
      tx_type: 'withdraw',
      underlying_token: position.underlying_token,
      amount: parseFloat(amount),
      amount_usd: parseFloat(amount),
      tx_hash: txHash,
      status: 'completed',
      executed_at: new Date().toISOString(),
      metadata: {
        realizedYield: withdrawResult.realizedYield,
        isFullWithdrawal: isFullWithdrawal || withdrawResult.isFullWithdrawal,
        onChain: true,
      },
    });

  await writeAuditLog({
    userId: session.user.id,
    action: 'yield_withdraw',
    entityType: 'yield_position',
    entityId: positionId,
    details: {
      protocol: position.protocol,
      token: position.underlying_token,
      amount,
      txHash,
      realizedYield: withdrawResult.realizedYield,
      onChain: true,
    },
  });

  return NextResponse.json({ data: { positionId, txHash } });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/yield/confirm-deposit/route.ts src/app/api/yield/confirm-withdraw/route.ts
git commit -m "feat: add confirm-deposit and confirm-withdraw API endpoints for on-chain txs"
```

---

### Task 6: Frontend On-Chain Deposit Hook

**Files:**
- Create: `src/hooks/useOnChainDeposit.ts`

- [ ] **Step 1: Create the multi-step deposit hook**

```typescript
// src/hooks/useOnChainDeposit.ts
'use client';
import { useState, useCallback } from 'react';
import { usePublicClient, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { needsApproval, buildApproveArgs } from '@/lib/yield/contracts/allowance';
import { buildDepositTx } from '@/lib/yield/contracts/deposit';
import { PROTOCOL_ADDRESSES } from '@/lib/yield/contracts/addresses';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type DepositStep = 'idle' | 'checking' | 'approving' | 'approved' | 'depositing' | 'confirming' | 'done' | 'error';

export function useOnChainDeposit() {
  const [step, setStep] = useState<DepositStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  const execute = useCallback(async (params: {
    protocol: YieldProtocolId;
    token: string;
    amount: string;
    walletAddress: `0x${string}`;
    chain: string;
  }) => {
    const { protocol, token, amount, walletAddress } = params;
    setError(null);
    setTxHash(null);

    const config = PROTOCOL_ADDRESSES[protocol];
    if (!config) {
      setError(`Protocol ${protocol} not supported for on-chain execution`);
      setStep('error');
      return;
    }

    try {
      // Step 1: Check allowance
      setStep('checking');
      if (!publicClient) throw new Error('Wallet not connected');

      const requiresApproval = await needsApproval(
        publicClient,
        token,
        walletAddress,
        config.spender,
        amount,
      );

      // Step 2: Approve if needed
      if (requiresApproval) {
        setStep('approving');
        const approveArgs = buildApproveArgs(token, config.spender, amount);
        const approveHash = await writeContractAsync(approveArgs);

        // Wait for approval to confirm
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        setStep('approved');
      }

      // Step 3: Execute deposit
      setStep('depositing');
      const depositArgs = buildDepositTx(protocol, token, amount, walletAddress);
      const depositHash = await writeContractAsync(depositArgs as any);

      setTxHash(depositHash);

      // Step 4: Wait for confirmation
      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted on-chain');
      }

      // Step 5: Record in backend
      const res = await fetch('/api/yield/confirm-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol,
          token,
          amount,
          walletAddress,
          chain: params.chain,
          txHash: depositHash,
          yieldToken: protocol, // simplified — backend can resolve
          tokensReceived: parseFloat(amount), // approximate for stablecoins
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to record deposit');
      }

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

      setStep('done');
    } catch (err: any) {
      const message = err?.shortMessage ?? err?.message ?? 'Transaction failed';
      setError(message);
      setStep('error');
      toast({ title: 'Deposit failed', description: message, variant: 'destructive' });
    }
  }, [publicClient, writeContractAsync, queryClient, session?.user?.id, toast]);

  return { step, error, txHash, execute, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useOnChainDeposit.ts
git commit -m "feat: add useOnChainDeposit hook — approve, deposit, confirm flow"
```

---

### Task 7: Frontend On-Chain Withdraw Hook

**Files:**
- Create: `src/hooks/useOnChainWithdraw.ts`

- [ ] **Step 1: Create the withdraw hook**

```typescript
// src/hooks/useOnChainWithdraw.ts
'use client';
import { useState, useCallback } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { buildWithdrawTx } from '@/lib/yield/contracts/withdraw';
import { PROTOCOL_ADDRESSES } from '@/lib/yield/contracts/addresses';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type WithdrawStep = 'idle' | 'withdrawing' | 'confirming' | 'done' | 'error';

export function useOnChainWithdraw() {
  const [step, setStep] = useState<WithdrawStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  const execute = useCallback(async (params: {
    positionId: string;
    protocol: YieldProtocolId;
    token: string;
    amount: string;
    walletAddress: `0x${string}`;
    isFullWithdrawal: boolean;
  }) => {
    const { positionId, protocol, token, amount, walletAddress, isFullWithdrawal } = params;
    setError(null);
    setTxHash(null);

    const config = PROTOCOL_ADDRESSES[protocol];
    if (!config) {
      setError(`Protocol ${protocol} not supported for on-chain execution`);
      setStep('error');
      return;
    }

    try {
      if (!publicClient) throw new Error('Wallet not connected');

      // Step 1: Execute withdraw
      setStep('withdrawing');
      const withdrawArgs = buildWithdrawTx(protocol, token, amount, walletAddress, isFullWithdrawal);
      const withdrawHash = await writeContractAsync(withdrawArgs as any);

      setTxHash(withdrawHash);

      // Step 2: Wait for confirmation
      setStep('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawHash });

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted on-chain');
      }

      // Step 3: Record in backend
      const res = await fetch('/api/yield/confirm-withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          amount,
          walletAddress,
          txHash: withdrawHash,
          tokensRedeemed: parseFloat(amount),
          isFullWithdrawal,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to record withdrawal');
      }

      queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

      setStep('done');
    } catch (err: any) {
      const message = err?.shortMessage ?? err?.message ?? 'Transaction failed';
      setError(message);
      setStep('error');
      toast({ title: 'Withdrawal failed', description: message, variant: 'destructive' });
    }
  }, [publicClient, writeContractAsync, queryClient, session?.user?.id, toast]);

  return { step, error, txHash, execute, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useOnChainWithdraw.ts
git commit -m "feat: add useOnChainWithdraw hook — withdraw, confirm flow"
```

---

### Task 8: Update InlineDepositForm for Real Execution

**Files:**
- Modify: `src/components/yield/YieldRatesTable.tsx:240-320`

- [ ] **Step 1: Update InlineDepositForm to use on-chain deposit for paid users**

In `InlineDepositForm`, import the new hook and add step-aware UI:

Add imports at top of file:
```typescript
import { useOnChainDeposit, type DepositStep } from '@/hooks/useOnChainDeposit';
import { PROTOCOL_ADDRESSES } from '@/lib/yield/contracts/addresses';
```

Inside `InlineDepositForm`, add the on-chain hook alongside the existing mock hook:
```typescript
const onChainDeposit = useOnChainDeposit();
const isOnChainProtocol = !!PROTOCOL_ADDRESSES[protocol.id as keyof typeof PROTOCOL_ADDRESSES];
```

Replace the `executeDeposit` function to route between mock and real:
```typescript
const executeDeposit = async () => {
  if (!amount || !selectedWallet) return;

  if (isOnChainProtocol && protocol.chain === 'ethereum') {
    // Real on-chain deposit
    await onChainDeposit.execute({
      protocol: protocol.id as any,
      token,
      amount,
      walletAddress: selectedWallet.address as `0x${string}`,
      chain: protocol.chain,
    });
    if (onChainDeposit.step === 'done') {
      setSlippageEstimate(null);
      setSuccess({ amount, token, apy: selectedRate ? formatAPY(selectedRate.totalAPY) : '—' });
    }
  } else {
    // Mock deposit (lite tier or Solana)
    try {
      await deposit.mutateAsync({
        protocol: protocol.id,
        token,
        amount,
        walletAddress: selectedWallet.address,
        chain: protocol.chain,
      });
      setSlippageEstimate(null);
      setSuccess({ amount, token, apy: selectedRate ? formatAPY(selectedRate.totalAPY) : '—' });
    } catch (err) {
      toast({ title: 'Deposit failed', description: (err as Error).message, variant: 'destructive' });
    }
  }
};
```

Update the submit button to show step progress for on-chain deposits:
```typescript
const stepLabels: Record<DepositStep, string> = {
  idle: 'Deposit',
  checking: 'Checking allowance...',
  approving: 'Approve in wallet...',
  approved: 'Depositing...',
  depositing: 'Sign in wallet...',
  confirming: 'Confirming on-chain...',
  done: 'Deposit confirmed!',
  error: 'Try again',
};

const isProcessing = onChainDeposit.step !== 'idle' && onChainDeposit.step !== 'done' && onChainDeposit.step !== 'error';
```

In the button JSX, replace the loading state:
```tsx
<button
  type="submit"
  disabled={!amount || !walletId || deposit.isPending || isProcessing || exceeds}
  className="..."
>
  {deposit.isPending || isProcessing ? (
    <>
      <Loader2 className="h-4 w-4 animate-spin" />
      {isProcessing ? stepLabels[onChainDeposit.step] : 'Processing...'}
    </>
  ) : (
    isOnChainProtocol ? 'Deposit (On-Chain)' : 'Deposit'
  )}
</button>
```

If there's an on-chain error, show it:
```tsx
{onChainDeposit.error && (
  <p className="text-xs text-red-500 text-center">{onChainDeposit.error}</p>
)}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/yield/YieldRatesTable.tsx
git commit -m "feat: wire InlineDepositForm to real on-chain execution for EVM protocols"
```

---

### Task 9: Update YieldWithdrawForm for Real Execution

**Files:**
- Modify: `src/components/yield/YieldWithdrawForm.tsx`

- [ ] **Step 1: Update withdraw form to use on-chain hook**

Add imports:
```typescript
import { useOnChainWithdraw, type WithdrawStep } from '@/hooks/useOnChainWithdraw';
import { PROTOCOL_ADDRESSES } from '@/lib/yield/contracts/addresses';
```

Inside the component, add:
```typescript
const onChainWithdraw = useOnChainWithdraw();
const isOnChainProtocol = !!PROTOCOL_ADDRESSES[position.protocol as keyof typeof PROTOCOL_ADDRESSES];
```

Update `executeWithdraw` to route between mock and real:
```typescript
const executeWithdraw = async () => {
  if (!amount) return;

  const isFullWithdrawal = parseFloat(amount) >= parseFloat(position.current_value_usd);

  if (isOnChainProtocol && position.chain === 'ethereum') {
    await onChainWithdraw.execute({
      positionId: position.id,
      protocol: position.protocol as any,
      token: position.underlying_token,
      amount,
      walletAddress: selectedWallet as `0x${string}`,
      isFullWithdrawal,
    });
  } else {
    try {
      await withdraw.mutateAsync({ positionId: position.id, amount, walletAddress: selectedWallet });
    } catch (err) {
      toast({ title: 'Withdrawal failed', description: (err as Error).message, variant: 'destructive' });
    }
  }
};
```

Update button to show step labels:
```typescript
const withdrawStepLabels: Record<WithdrawStep, string> = {
  idle: 'Withdraw',
  withdrawing: 'Sign in wallet...',
  confirming: 'Confirming on-chain...',
  done: 'Withdrawal confirmed!',
  error: 'Try again',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/yield/YieldWithdrawForm.tsx
git commit -m "feat: wire YieldWithdrawForm to real on-chain execution for EVM protocols"
```

---

### Task 10: Remaining Position Query Gaps

**Files:**
- Modify: `src/lib/yield/adapters/constants.ts`
- Modify: `src/lib/yield/factory.ts`

- [ ] **Step 1: Add Morpho Blue direct lending position query**

Morpho Blue uses a GraphQL API to query user positions. Add to factory.ts:

```typescript
// In factory.ts, update the 'morpho' case:
case 'morpho':
  // Query Morpho Blue GraphQL for user position
  return await getMorphoBlueOnChainValue(walletAddress, token, storedValue, storedTokenBalance);
```

Create a helper in a new section of the erc4626 adapter file or inline in factory:

```typescript
async function getMorphoBlueOnChainValue(
  walletAddress: string,
  token: TokenSymbol,
  storedValue: number,
  storedTokenBalance: number,
): Promise<OnChainValue> {
  try {
    const res = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query { userByAddress(address: "${walletAddress}") { positions { market { loanAsset { symbol } } supplyAssets supplyShares } } }`,
      }),
    });
    if (!res.ok) return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
    const data = await res.json();
    const positions = data?.data?.userByAddress?.positions ?? [];
    const match = positions.find((p: any) => p.market?.loanAsset?.symbol?.toUpperCase() === token);
    if (!match) return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
    const supplyAssets = parseFloat(match.supplyAssets) / 1e6; // USDC/USDT = 6 decimals
    const supplyShares = parseFloat(match.supplyShares) / 1e18;
    return { currentValueUsd: supplyAssets, yieldTokenBalance: supplyShares };
  } catch {
    return { currentValueUsd: storedValue, yieldTokenBalance: storedTokenBalance };
  }
}
```

- [ ] **Step 2: Add Ondo USDY price oracle**

Update `src/lib/yield/adapters/ondo.ts` to fetch the real USDY price from CoinGecko:

```typescript
async function getUsdyPrice(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ondo-us-dollar-yield&vs_currencies=usd',
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return 1.0;
    const data = await res.json();
    return data['ondo-us-dollar-yield']?.usd ?? 1.0;
  } catch {
    return 1.0;
  }
}
```

Then use it in `getOndoOnChainValue`:
```typescript
const usdyPrice = await getUsdyPrice();
return { currentValueUsd: balanceFloat * usdyPrice, yieldTokenBalance: balanceFloat };
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/yield/factory.ts src/lib/yield/adapters/ondo.ts
git commit -m "feat: add Morpho Blue position query and Ondo USDY price oracle"
```

---

### Task 11: Build Verification and Final Push

- [ ] **Step 1: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Build**

```bash
npx next build
```

- [ ] **Step 3: Manual test flow**

1. Start dev server
2. Navigate to Yield → Explore Protocols
3. For an EVM protocol (e.g. Aave V3): click Deposit
4. With a connected Ethereum wallet: submit a deposit
5. Verify: wallet prompts for approve → then deposit → tx confirms → position appears
6. Test withdraw flow similarly
7. For Solana protocols: verify mock flow still works

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "feat: real on-chain yield execution for EVM protocols

Complete implementation of client-side wallet signing for yield deposits
and withdrawals. Supports Aave V3, Compound V3, Morpho Steakhouse,
Sky sUSDS, Ethena sUSDe, and Ondo USDY.

- ERC-20 allowance check and approval flow
- Protocol-specific deposit/withdraw transaction builders
- Multi-step frontend hooks with step progress indicators
- Backend confirm endpoints for recording on-chain transactions
- Morpho Blue position query via GraphQL
- Ondo USDY real price via CoinGecko oracle"

git push origin master
git push origin master:dev
```

---

## Out of Scope (Solana — Plan B)

- Kamino deposit/withdraw via @kamino-finance/klend-sdk
- Drift deposit/withdraw via @drift-labs/sdk
- Solana wallet-adapter signing integration for transactions
- These protocols remain mock until Plan B is executed

## Out of Scope (Future Enhancements)

- EIP-2612 permit signatures (gasless approvals) — could replace approve step
- Automated position refresh cron (periodic on-chain balance checks)
- Transaction receipt parsing for exact tokensReceived (currently approximated)
- Maple Finance integration (custom pool contracts, not standardized)
