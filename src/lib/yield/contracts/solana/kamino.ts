/**
 * Kamino Lend instruction builders and position queries.
 *
 * The Kamino SDK (@kamino-finance/klend-sdk v7+) uses @solana/kit types
 * (Address, TransactionSigner, Rpc<KaminoMarketRpcApi>) internally.
 * This module bridges those types to the @solana/web3.js Connection /
 * PublicKey / Transaction types used everywhere else in this codebase.
 *
 * Deposit/withdraw transaction building uses KaminoAction.buildDepositTxns /
 * buildWithdrawTxns and converts the resulting kit-style Instruction objects
 * back to web3.js TransactionInstruction format before packing them into a
 * legacy Transaction.
 *
 * Position queries fall back to the Kamino public REST API so they work even
 * in read-only contexts where no signer is available.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  AccountMeta as Web3AccountMeta,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// ─── Constants ───────────────────────────────────────────────────────────────

const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';

/** Decimals for each supported token (used to convert UI amounts → lamports). */
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
};

const TOKEN_MINTS: Record<string, string> = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

const KAMINO_API_BASE = 'https://api.kamino.finance';
const SLOT_DURATION_MS = 400;

// ─── Return types ────────────────────────────────────────────────────────────

export interface KaminoPosition {
  currentValueUsd: number;
  yieldTokenBalance: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a kit-style `Instruction` (from @solana/kit) to a web3.js
 * `TransactionInstruction`. The kit Instruction shape is:
 *   { programAddress: Address, accounts: AccountMeta[], data: Uint8Array }
 * where Address is a base-58 string and AccountMeta uses `address` (string)
 * rather than `pubkey` (PublicKey).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kitIxToWeb3Ix(ix: any): TransactionInstruction {
  const keys: Web3AccountMeta[] = (ix.accounts ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (meta: any): Web3AccountMeta => ({
      pubkey: new PublicKey(meta.address),
      isSigner: meta.role === 2 || meta.role === 3, // SIGNER or WRITABLE_SIGNER
      isWritable: meta.role === 1 || meta.role === 3, // WRITABLE or WRITABLE_SIGNER
    })
  );

  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys,
    data: Buffer.from(ix.data ?? []),
  });
}

/**
 * Pack an array of kit Instructions into a legacy Transaction.
 * Returns an empty Transaction on empty input.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ixsToTransaction(ixs: any[]): Transaction {
  const tx = new Transaction();
  for (const ix of ixs) {
    try {
      tx.add(kitIxToWeb3Ix(ix));
    } catch {
      // Skip malformed instructions rather than blowing up the whole tx.
    }
  }
  return tx;
}

/**
 * Build a minimal TransactionSigner-shaped object from a web3.js PublicKey.
 * The signer is read-only (no sign capability) — sufficient for building
 * unsigned transactions that the wallet will sign later.
 */
function makeDummySigner(pubkey: PublicKey) {
  return {
    address: pubkey.toBase58(),
    // The SDK calls signTransaction/signAllTransactions only when actually
    // sending; we intercept before that point.
    signTransaction: undefined as unknown,
    signAllTransactions: undefined as unknown,
  };
}

// ─── Lazy SDK import helpers ──────────────────────────────────────────────────

// The Kamino SDK uses ESM-first imports; we load lazily to avoid bundler
// issues in SSR contexts.

async function loadKaminoSDK() {
  const sdk = await import('@kamino-finance/klend-sdk');
  return sdk;
}

// ─── createRpcFromConnection ──────────────────────────────────────────────────

/**
 * Wrap a web3.js Connection into the thin Rpc proxy that KaminoMarket.load
 * expects. The kit Rpc object is simply a Proxy whose methods match the
 * KaminoMarketRpcApi method names (getAccountInfo, getMultipleAccounts, …).
 *
 * Rather than shimming every method, we construct the Rpc using the official
 * @solana/kit createDefaultRpc helper if available, otherwise we fall back to
 * a manual shim.
 */
function createRpcFromConnection(connection: Connection) {
  // The Kamino SDK internally calls rpc.getAccountInfo(...).send(), etc.
  // We create a Proxy that delegates each method to the Connection.
  const rpcEndpoint = connection.rpcEndpoint;

  // Attempt to use @solana/kit's own rpc factory if present.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kit = require('@solana/kit');
    if (kit.createSolanaRpc) {
      return kit.createSolanaRpc(rpcEndpoint);
    }
    if (kit.createDefaultRpc) {
      return kit.createDefaultRpc(rpcEndpoint);
    }
  } catch {
    // @solana/kit may not expose these helpers in this version.
  }

  // Manual shim: each property returns a function that proxies to Connection
  // and wraps the result in a { send() } thenable.
  return new Proxy(
    {},
    {
      get(_target, method: string) {
        return (...args: unknown[]) => ({
          send: async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fn = (connection as any)[method];
            if (typeof fn === 'function') {
              return fn.apply(connection, args);
            }
            throw new Error(`Connection has no method: ${method}`);
          },
        });
      },
    }
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a Kamino Lend deposit transaction.
 *
 * @param connection  web3.js Connection to the Solana cluster.
 * @param walletPubkey  Depositor's public key.
 * @param token  "USDC" | "USDT" (must exist in TOKEN_MINTS).
 * @param amount  Amount in token units (e.g. 100 for 100 USDC).
 * @returns An unsigned legacy Transaction ready to be signed and sent.
 */
export async function buildKaminoDepositTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number
): Promise<Transaction> {
  try {
    const mint = TOKEN_MINTS[token];
    if (!mint) throw new Error(`Unsupported token: ${token}`);

    const decimals = TOKEN_DECIMALS[token] ?? 6;
    const lamports = new BN(Math.round(amount * 10 ** decimals));

    const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
      await loadKaminoSDK();

    const rpc = createRpcFromConnection(connection);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const marketAddr = KAMINO_MAIN_MARKET as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const programAddr = PROGRAM_ID as any;

    const market = await KaminoMarket.load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rpc as any,
      marketAddr,
      SLOT_DURATION_MS,
      programAddr
    );
    if (!market) throw new Error('KaminoMarket failed to load');

    const owner = makeDummySigner(walletPubkey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obligation = new VanillaObligation(programAddr as any);

    const action = await KaminoAction.buildDepositTxns(
      market,
      lamports.toString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mint as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      owner as any,
      obligation,
      true, // useV2Ixs
      undefined // no scope price refresh
    );

    const allIxs = [
      ...action.setupIxs,
      ...action.lendingIxs,
      ...action.cleanupIxs,
    ];

    return ixsToTransaction(allIxs);
  } catch (err) {
    console.error('[Kamino] buildKaminoDepositTx error:', err);
    return new Transaction();
  }
}

/**
 * Build a Kamino Lend withdraw transaction.
 *
 * @param connection  web3.js Connection.
 * @param walletPubkey  Withdrawer's public key.
 * @param token  "USDC" | "USDT".
 * @param amount  Amount in token units (ignored when isFullWithdrawal=true).
 * @param isFullWithdrawal  When true, withdraws the entire position (u64 max).
 * @returns An unsigned legacy Transaction.
 */
export async function buildKaminoWithdrawTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
  isFullWithdrawal = false
): Promise<Transaction> {
  try {
    const mint = TOKEN_MINTS[token];
    if (!mint) throw new Error(`Unsupported token: ${token}`);

    const decimals = TOKEN_DECIMALS[token] ?? 6;
    // Use u64 max (as string) for a full withdrawal; Kamino interprets this
    // as "withdraw everything".
    const amountStr = isFullWithdrawal
      ? new BN('18446744073709551615').toString() // u64::MAX
      : new BN(Math.round(amount * 10 ** decimals)).toString();

    const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
      await loadKaminoSDK();

    const rpc = createRpcFromConnection(connection);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const marketAddr2 = KAMINO_MAIN_MARKET as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const programAddr2 = PROGRAM_ID as any;

    const market = await KaminoMarket.load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rpc as any,
      marketAddr2,
      SLOT_DURATION_MS,
      programAddr2
    );
    if (!market) throw new Error('KaminoMarket failed to load');

    const owner = makeDummySigner(walletPubkey);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obligation = new VanillaObligation(programAddr2 as any);

    const action = await KaminoAction.buildWithdrawTxns(
      market,
      amountStr,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mint as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      owner as any,
      obligation,
      true, // useV2Ixs
      undefined // no scope price refresh
    );

    const allIxs = [
      ...action.setupIxs,
      ...action.lendingIxs,
      ...action.cleanupIxs,
    ];

    return ixsToTransaction(allIxs);
  } catch (err) {
    console.error('[Kamino] buildKaminoWithdrawTx error:', err);
    return new Transaction();
  }
}

/**
 * Query the current Kamino Lend position for a wallet + token.
 *
 * Uses the Kamino REST API so no on-chain RPC calls are required and this
 * works in server components / API routes without a signer.
 *
 * REST endpoint:
 *   GET https://api.kamino.finance/kamino-market/{market}/users/{wallet}
 *
 * Falls back to zero values on any error.
 */
export async function getKaminoPosition(
  _connection: Connection,
  walletPubkey: PublicKey,
  token: string
): Promise<KaminoPosition> {
  const zero: KaminoPosition = { currentValueUsd: 0, yieldTokenBalance: 0 };

  try {
    const mint = TOKEN_MINTS[token];
    if (!mint) return zero;

    const url = `${KAMINO_API_BASE}/kamino-market/${KAMINO_MAIN_MARKET}/users/${walletPubkey.toBase58()}`;
    const res = await fetch(url, { next: { revalidate: 30 } } as RequestInit);
    if (!res.ok) return zero;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();

    // The response has a `deposits` array where each entry looks like:
    //   { mintAddress: string, amount: string, marketValue: string }
    // The exact field names may differ across API versions; we probe multiple.
    const deposits: unknown[] =
      data?.deposits ??
      data?.userDeposits ??
      data?.obligation?.deposits ??
      [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const match = (deposits as any[]).find(
      (d) =>
        d?.mintAddress === mint ||
        d?.mint === mint ||
        d?.reserveMint === mint
    );

    if (!match) return zero;

    const currentValueUsd = parseFloat(
      match.marketValue ?? match.marketValueUsd ?? match.value ?? '0'
    );
    const yieldTokenBalance = parseFloat(
      match.amount ?? match.balance ?? '0'
    );

    return {
      currentValueUsd: isNaN(currentValueUsd) ? 0 : currentValueUsd,
      yieldTokenBalance: isNaN(yieldTokenBalance) ? 0 : yieldTokenBalance,
    };
  } catch (err) {
    console.error('[Kamino] getKaminoPosition error:', err);
    return zero;
  }
}
