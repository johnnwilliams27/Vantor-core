# Solana On-Chain Yield Execution — Plan B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable real on-chain deposits and withdrawals for the 3 Solana yield protocols (Kamino Lend, Kamino Multiply, Drift), completing full protocol coverage alongside the EVM protocols from Plan A.

**Architecture:** Same two-phase model as Plan A — frontend builds and signs transactions via `@solana/wallet-adapter`, backend records confirmed transactions. Solana wallet adapter is already configured with Phantom, Solflare, and Ledger support. Key difference from EVM: Solana transactions use instruction-based programs rather than contract function calls, and each protocol has its own SDK for building instructions.

**Tech Stack:** @solana/web3.js, @solana/wallet-adapter-react, @kamino-finance/klend-sdk (Kamino), @drift-labs/sdk (Drift), existing Solana wallet adapter configuration.

**Prerequisite:** Plan A must be completed first — this plan reuses the confirm endpoints and hook patterns.

---

## Solana vs EVM Differences

| | EVM (Plan A) | Solana (Plan B) |
|---|---|---|
| Wallet | wagmi + RainbowKit | @solana/wallet-adapter |
| Signing | `writeContractAsync()` | `sendTransaction()` via wallet adapter |
| Token approval | ERC-20 `approve()` | SPL Token `approve()` or delegated via program |
| Transaction building | ABI + viem encoding | Instruction building via protocol SDK |
| Confirmation | `waitForTransactionReceipt()` | `confirmTransaction()` |
| Provider scope | App-wide (wagmi wraps entire app) | Page-scoped (wallet adapter wraps wallets page only) |

**Important:** The Solana wallet adapter is currently only wrapped around the wallets page (`src/app/(app)/wallets/page.tsx`). For yield operations, we need to lift the Solana providers to the app layout level or wrap the yield page.

---

## File Structure

### New files
- `src/lib/yield/contracts/solana/kamino.ts` — Kamino instruction builder
- `src/lib/yield/contracts/solana/drift.ts` — Drift instruction builder
- `src/hooks/useSolanaDeposit.ts` — Solana deposit hook (wallet-adapter signing)
- `src/hooks/useSolanaWithdraw.ts` — Solana withdraw hook

### Modified files
- `src/app/providers.tsx` — Lift Solana wallet providers to app level
- `src/components/yield/YieldRatesTable.tsx` — Route Solana protocols to Solana hooks
- `src/components/yield/YieldWithdrawForm.tsx` — Route Solana protocols to Solana hooks
- `src/lib/yield/factory.ts` — Wire Kamino/Drift position queries (replace stubs)
- `package.json` — Add @kamino-finance/klend-sdk, @drift-labs/sdk

---

### Task 1: Install Solana Protocol SDKs

- [ ] **Step 1: Install Kamino and Drift SDKs**

```bash
npm install @kamino-finance/klend-sdk @drift-labs/sdk
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Kamino and Drift SDK dependencies"
```

---

### Task 2: Lift Solana Providers to App Level

**Files:**
- Modify: `src/app/providers.tsx`
- Modify: `src/app/(app)/wallets/page.tsx` — Remove duplicate Solana providers

- [ ] **Step 1: Add Solana providers to the app-level Providers component**

In `src/app/providers.tsx`, add Solana wallet adapter providers wrapping the children, so they're available on the yield page too:

```typescript
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter, LedgerWalletAdapter } from '@solana/wallet-adapter-wallets';
import { useMemo } from 'react';

// Inside the Providers component:
const solanaWallets = useMemo(() => [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new LedgerWalletAdapter(),
], []);

const solanaEndpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
```

Wrap children:
```tsx
<ConnectionProvider endpoint={solanaEndpoint}>
  <WalletProvider wallets={solanaWallets} autoConnect>
    <WalletModalProvider>
      {children}
    </WalletModalProvider>
  </WalletProvider>
</ConnectionProvider>
```

- [ ] **Step 2: Remove duplicate providers from wallets page**

In `src/app/(app)/wallets/page.tsx`, remove the local Solana provider wrapping since it's now at app level.

- [ ] **Step 3: Commit**

```bash
git add src/app/providers.tsx src/app/\(app\)/wallets/page.tsx
git commit -m "feat: lift Solana wallet providers to app level for yield access"
```

---

### Task 3: Kamino Instruction Builder

**Files:**
- Create: `src/lib/yield/contracts/solana/kamino.ts`

- [ ] **Step 1: Create Kamino deposit/withdraw instruction builder**

```typescript
// src/lib/yield/contracts/solana/kamino.ts
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { KaminoMarket } from '@kamino-finance/klend-sdk';

const KAMINO_MAIN_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

const TOKEN_MINTS: Record<string, PublicKey> = {
  USDC: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  USDT: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
};

/**
 * Build a Kamino Lend deposit transaction.
 */
export async function buildKaminoDepositTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
): Promise<Transaction> {
  const market = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET);
  if (!market) throw new Error('Failed to load Kamino market');

  const mint = TOKEN_MINTS[token];
  if (!mint) throw new Error(`Unsupported token for Kamino: ${token}`);

  const reserve = market.getReserveByMint(mint);
  if (!reserve) throw new Error(`No Kamino reserve for ${token}`);

  // Amount in token's smallest unit (USDC/USDT = 6 decimals)
  const lamports = BigInt(Math.round(amount * 1e6));

  const ixs = await market.makeDepositIxs(
    walletPubkey,
    mint,
    lamports,
  );

  const tx = new Transaction();
  for (const ix of ixs) {
    tx.add(ix);
  }

  return tx;
}

/**
 * Build a Kamino Lend withdraw transaction.
 */
export async function buildKaminoWithdrawTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
  isFullWithdrawal: boolean,
): Promise<Transaction> {
  const market = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET);
  if (!market) throw new Error('Failed to load Kamino market');

  const mint = TOKEN_MINTS[token];
  if (!mint) throw new Error(`Unsupported token for Kamino: ${token}`);

  const lamports = isFullWithdrawal
    ? BigInt('18446744073709551615') // u64::MAX for full withdrawal
    : BigInt(Math.round(amount * 1e6));

  const ixs = await market.makeWithdrawIxs(
    walletPubkey,
    mint,
    lamports,
  );

  const tx = new Transaction();
  for (const ix of ixs) {
    tx.add(ix);
  }

  return tx;
}

/**
 * Query Kamino position for a wallet.
 */
export async function getKaminoPosition(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
): Promise<{ currentValueUsd: number; yieldTokenBalance: number }> {
  try {
    const market = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET);
    if (!market) return { currentValueUsd: 0, yieldTokenBalance: 0 };

    const mint = TOKEN_MINTS[token];
    if (!mint) return { currentValueUsd: 0, yieldTokenBalance: 0 };

    const obligation = await market.getUserObligation(walletPubkey);
    if (!obligation) return { currentValueUsd: 0, yieldTokenBalance: 0 };

    const deposit = obligation.deposits.find(
      (d) => d.mintAddress.equals(mint),
    );

    if (!deposit) return { currentValueUsd: 0, yieldTokenBalance: 0 };

    return {
      currentValueUsd: deposit.marketValueRefreshed.toNumber(),
      yieldTokenBalance: deposit.amount.toNumber() / 1e6,
    };
  } catch (err) {
    console.error('[kamino] Position query failed:', err);
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/contracts/solana/kamino.ts
git commit -m "feat: add Kamino Lend instruction builder and position query"
```

---

### Task 4: Drift Instruction Builder

**Files:**
- Create: `src/lib/yield/contracts/solana/drift.ts`

- [ ] **Step 1: Create Drift deposit/withdraw instruction builder**

```typescript
// src/lib/yield/contracts/solana/drift.ts
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { DriftClient, initialize, BulkAccountLoader, QUOTE_SPOT_MARKET_INDEX } from '@drift-labs/sdk';

const TOKEN_SPOT_MARKETS: Record<string, number> = {
  USDC: QUOTE_SPOT_MARKET_INDEX, // 0
  USDT: 1,
};

/**
 * Create a Drift client for the given connection and wallet.
 */
async function getDriftClient(
  connection: Connection,
  walletPubkey: PublicKey,
): Promise<DriftClient> {
  const sdkConfig = initialize({ env: 'mainnet-beta' });

  const accountLoader = new BulkAccountLoader(connection, 'confirmed', 1000);

  const driftClient = new DriftClient({
    connection,
    wallet: { publicKey: walletPubkey, signTransaction: async (tx) => tx, signAllTransactions: async (txs) => txs },
    programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
    accountSubscription: { type: 'polling', accountLoader },
  });

  await driftClient.subscribe();
  return driftClient;
}

/**
 * Build a Drift deposit transaction.
 */
export async function buildDriftDepositTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
): Promise<Transaction> {
  const marketIndex = TOKEN_SPOT_MARKETS[token];
  if (marketIndex === undefined) throw new Error(`Unsupported token for Drift: ${token}`);

  const driftClient = await getDriftClient(connection, walletPubkey);

  try {
    const amountBN = driftClient.convertToSpotPrecision(marketIndex, amount);
    const ix = await driftClient.getDepositIx(amountBN, marketIndex);

    const tx = new Transaction();
    tx.add(ix);
    return tx;
  } finally {
    await driftClient.unsubscribe();
  }
}

/**
 * Build a Drift withdraw transaction.
 */
export async function buildDriftWithdrawTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
  isFullWithdrawal: boolean,
): Promise<Transaction> {
  const marketIndex = TOKEN_SPOT_MARKETS[token];
  if (marketIndex === undefined) throw new Error(`Unsupported token for Drift: ${token}`);

  const driftClient = await getDriftClient(connection, walletPubkey);

  try {
    const user = driftClient.getUser();
    const spotPosition = user.getSpotPosition(marketIndex);

    let amountBN;
    if (isFullWithdrawal && spotPosition) {
      amountBN = spotPosition.scaledBalance;
    } else {
      amountBN = driftClient.convertToSpotPrecision(marketIndex, amount);
    }

    const ix = await driftClient.getWithdrawIx(amountBN, marketIndex);

    const tx = new Transaction();
    tx.add(ix);
    return tx;
  } finally {
    await driftClient.unsubscribe();
  }
}

/**
 * Query Drift lending position for a wallet.
 */
export async function getDriftPosition(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
): Promise<{ currentValueUsd: number; yieldTokenBalance: number }> {
  const marketIndex = TOKEN_SPOT_MARKETS[token];
  if (marketIndex === undefined) return { currentValueUsd: 0, yieldTokenBalance: 0 };

  try {
    const driftClient = await getDriftClient(connection, walletPubkey);
    try {
      const user = driftClient.getUser();
      const spotPosition = user.getSpotPosition(marketIndex);
      if (!spotPosition) return { currentValueUsd: 0, yieldTokenBalance: 0 };

      const tokenAmount = user.getTokenAmount(marketIndex).toNumber() / 1e6;
      return { currentValueUsd: tokenAmount, yieldTokenBalance: tokenAmount };
    } finally {
      await driftClient.unsubscribe();
    }
  } catch (err) {
    console.error('[drift] Position query failed:', err);
    return { currentValueUsd: 0, yieldTokenBalance: 0 };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/contracts/solana/drift.ts
git commit -m "feat: add Drift instruction builder and position query"
```

---

### Task 5: Solana Deposit Hook

**Files:**
- Create: `src/hooks/useSolanaDeposit.ts`

- [ ] **Step 1: Create the Solana deposit hook**

```typescript
// src/hooks/useSolanaDeposit.ts
'use client';
import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { PublicKey } from '@solana/web3.js';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type SolanaDepositStep = 'idle' | 'building' | 'signing' | 'confirming' | 'recording' | 'done' | 'error';

export function useSolanaDeposit() {
  const [step, setStep] = useState<SolanaDepositStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
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
    walletAddress: string;
    chain: string;
  }) => {
    const { protocol, token, amount, walletAddress } = params;
    setError(null);
    setTxHash(null);

    if (!publicKey) {
      setError('Solana wallet not connected');
      setStep('error');
      return;
    }

    try {
      // Step 1: Build transaction
      setStep('building');

      let tx;
      const amountNum = parseFloat(amount);

      if (protocol === 'kamino' || protocol === 'kamino_multiply') {
        const { buildKaminoDepositTx } = await import('@/lib/yield/contracts/solana/kamino');
        tx = await buildKaminoDepositTx(connection, publicKey, token, amountNum);
      } else if (protocol === 'drift') {
        const { buildDriftDepositTx } = await import('@/lib/yield/contracts/solana/drift');
        tx = await buildDriftDepositTx(connection, publicKey, token, amountNum);
      } else {
        throw new Error(`Protocol ${protocol} not supported for Solana deposit`);
      }

      // Step 2: Sign and send
      setStep('signing');
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);
      setTxHash(signature);

      // Step 3: Confirm
      setStep('confirming');
      await connection.confirmTransaction(signature, 'confirmed');

      // Step 4: Record in backend
      setStep('recording');
      const res = await fetch('/api/yield/confirm-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol,
          token,
          amount,
          walletAddress,
          chain: 'solana',
          txHash: signature,
          yieldToken: protocol,
          tokensReceived: amountNum,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to record deposit');
      }

      queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
      queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

      setStep('done');
    } catch (err: any) {
      const message = err?.message ?? 'Transaction failed';
      setError(message);
      setStep('error');
      toast({ title: 'Deposit failed', description: message, variant: 'destructive' });
    }
  }, [connection, publicKey, sendTransaction, queryClient, session?.user?.id, toast]);

  return { step, error, txHash, execute, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSolanaDeposit.ts
git commit -m "feat: add useSolanaDeposit hook for Kamino and Drift"
```

---

### Task 6: Solana Withdraw Hook

**Files:**
- Create: `src/hooks/useSolanaWithdraw.ts`

- [ ] **Step 1: Create the Solana withdraw hook**

Same pattern as deposit but calls withdraw builders. Use dynamic imports for Kamino/Drift.

```typescript
// src/hooks/useSolanaWithdraw.ts
'use client';
import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type SolanaWithdrawStep = 'idle' | 'building' | 'signing' | 'confirming' | 'recording' | 'done' | 'error';

export function useSolanaWithdraw() {
  const [step, setStep] = useState<SolanaWithdrawStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
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
    walletAddress: string;
    isFullWithdrawal: boolean;
  }) => {
    const { positionId, protocol, token, amount, walletAddress, isFullWithdrawal } = params;
    setError(null);
    setTxHash(null);

    if (!publicKey) {
      setError('Solana wallet not connected');
      setStep('error');
      return;
    }

    try {
      setStep('building');
      const amountNum = parseFloat(amount);

      let tx;
      if (protocol === 'kamino' || protocol === 'kamino_multiply') {
        const { buildKaminoWithdrawTx } = await import('@/lib/yield/contracts/solana/kamino');
        tx = await buildKaminoWithdrawTx(connection, publicKey, token, amountNum, isFullWithdrawal);
      } else if (protocol === 'drift') {
        const { buildDriftWithdrawTx } = await import('@/lib/yield/contracts/solana/drift');
        tx = await buildDriftWithdrawTx(connection, publicKey, token, amountNum, isFullWithdrawal);
      } else {
        throw new Error(`Protocol ${protocol} not supported for Solana withdraw`);
      }

      setStep('signing');
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);
      setTxHash(signature);

      setStep('confirming');
      await connection.confirmTransaction(signature, 'confirmed');

      setStep('recording');
      const res = await fetch('/api/yield/confirm-withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          positionId,
          amount,
          walletAddress,
          txHash: signature,
          tokensRedeemed: amountNum,
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
      const message = err?.message ?? 'Transaction failed';
      setError(message);
      setStep('error');
      toast({ title: 'Withdrawal failed', description: message, variant: 'destructive' });
    }
  }, [connection, publicKey, sendTransaction, queryClient, session?.user?.id, toast]);

  return { step, error, txHash, execute, reset };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSolanaWithdraw.ts
git commit -m "feat: add useSolanaWithdraw hook for Kamino and Drift"
```

---

### Task 7: Wire Solana Hooks into Deposit/Withdraw UI

**Files:**
- Modify: `src/components/yield/YieldRatesTable.tsx`
- Modify: `src/components/yield/YieldWithdrawForm.tsx`

- [ ] **Step 1: Update InlineDepositForm for Solana**

Add imports:
```typescript
import { useSolanaDeposit, type SolanaDepositStep } from '@/hooks/useSolanaDeposit';
```

In InlineDepositForm, add:
```typescript
const solanaDeposit = useSolanaDeposit();
const isSolanaProtocol = protocol.chain === 'solana';
```

In `executeDeposit`, add Solana branch:
```typescript
if (isSolanaProtocol) {
  await solanaDeposit.execute({
    protocol: protocol.id as any,
    token,
    amount,
    walletAddress: selectedWallet.address,
    chain: 'solana',
  });
  if (solanaDeposit.step === 'done') {
    setSlippageEstimate(null);
    setSuccess({ amount, token, apy: selectedRate ? formatAPY(selectedRate.totalAPY) : '—' });
  }
  return;
}
```

Add Solana step labels:
```typescript
const solanaStepLabels: Record<SolanaDepositStep, string> = {
  idle: 'Deposit',
  building: 'Building transaction...',
  signing: 'Sign in wallet...',
  confirming: 'Confirming on Solana...',
  recording: 'Recording...',
  done: 'Deposit confirmed!',
  error: 'Try again',
};
```

- [ ] **Step 2: Update YieldWithdrawForm for Solana**

Same pattern — import `useSolanaWithdraw`, detect Solana protocol, route accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/components/yield/YieldRatesTable.tsx src/components/yield/YieldWithdrawForm.tsx
git commit -m "feat: wire Solana deposit/withdraw hooks into yield UI"
```

---

### Task 8: Wire Kamino/Drift Position Queries into Factory

**Files:**
- Modify: `src/lib/yield/factory.ts`

- [ ] **Step 1: Replace stubs with real position queries**

The Kamino and Drift position queries need a Solana Connection object, which is server-side. Create it in the factory:

```typescript
import { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

function getSolanaConnection(): Connection {
  const url = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  return new Connection(url, 'confirmed');
}
```

Update the switch cases:
```typescript
case 'kamino':
case 'kamino_multiply': {
  const { getKaminoPosition } = await import('./contracts/solana/kamino');
  const conn = getSolanaConnection();
  return await getKaminoPosition(conn, new PublicKey(walletAddress), token);
}
case 'drift': {
  const { getDriftPosition } = await import('./contracts/solana/drift');
  const conn = getSolanaConnection();
  return await getDriftPosition(conn, new PublicKey(walletAddress), token);
}
```

Remove the old stub imports.

- [ ] **Step 2: Commit**

```bash
git add src/lib/yield/factory.ts
git commit -m "feat: wire Kamino/Drift position queries into factory (replace stubs)"
```

---

### Task 9: Build Verification and Push

- [ ] **Step 1: Type check and build**

```bash
npx tsc --noEmit && npx next build
```

- [ ] **Step 2: Commit and push**

```bash
git add -A
git commit -m "feat: Solana on-chain yield execution — Kamino and Drift

Real on-chain deposit/withdraw for Solana protocols via wallet-adapter.
Kamino uses klend-sdk, Drift uses @drift-labs/sdk.
Position queries now hit real on-chain data."

git push origin master
git push origin master:dev
```

---

## Notes

- Kamino Multiply uses the same market but with leveraged strategies. The deposit flow may need adjustment if Multiply uses a different program endpoint. Verify against SDK docs.
- Drift SDK initialization is heavyweight — consider caching the DriftClient instance or using a lighter query approach for position reads.
- Solana transaction size limits may require splitting large deposits into multiple transactions if the instruction set is large.
