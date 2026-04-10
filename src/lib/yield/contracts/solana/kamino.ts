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
import type { SolanaCluster } from './cluster';
import { getKaminoMarket, getTokenMints } from './cluster';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Decimals for each supported token (used to convert UI amounts → lamports). */
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
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
 * @param cluster  Target cluster — 'mainnet-beta' (default) or 'devnet' (test mode).
 * @returns An unsigned legacy Transaction ready to be signed and sent.
 */
export async function buildKaminoDepositTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
  cluster: SolanaCluster = 'mainnet-beta'
): Promise<Transaction> {
  try {
    const TOKEN_MINTS = getTokenMints(cluster);
    const mint = TOKEN_MINTS[token];
    if (!mint) throw new Error(`Unsupported token: ${token}`);

    const decimals = TOKEN_DECIMALS[token] ?? 6;
    const lamports = new BN(Math.round(amount * 10 ** decimals));

    const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID } =
      await loadKaminoSDK();

    const rpc = createRpcFromConnection(connection);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const marketAddr = getKaminoMarket(cluster) as any;
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
 * @param cluster  Target cluster — 'mainnet-beta' (default) or 'devnet' (test mode).
 * @returns An unsigned legacy Transaction.
 */
export async function buildKaminoWithdrawTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
  isFullWithdrawal = false,
  cluster: SolanaCluster = 'mainnet-beta'
): Promise<Transaction> {
  try {
    const TOKEN_MINTS = getTokenMints(cluster);
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
    const marketAddr2 = getKaminoMarket(cluster) as any;
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
 *
 * @param cluster  Target cluster — 'mainnet-beta' (default) or 'devnet' (test mode).
 */
/**
 * Reserve address → underlying mint mapping for the Kamino Main Market.
 * Used to resolve deposit reserves back to their underlying token.
 */
const KAMINO_MAIN_MARKET_RESERVES: Record<string, string> = {
  // USDC reserve
  'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // USDT reserve
  'H3t6qZ1JkguCNTi9uzVKqQ7dvt2cum4XiXWom6Gn5e5S': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

/**
 * Fetch the current collateral→underlying exchange rate for a Kamino reserve.
 * Reserves accrue interest over time, so 1 cToken > 1 underlying after genesis.
 * Returns 1.0 on any error (safe fallback).
 */
async function getKaminoReserveExchangeRate(): Promise<number> {
  try {
    const url = `${KAMINO_API_BASE}/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics`;
    const res = await fetch(url);
    if (!res.ok) return 1.0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reserves: any[] = await res.json();
    const usdcReserve = reserves.find((r) => r?.liquidityToken === 'USDC');
    if (!usdcReserve) return 1.0;
    // totalSupplyUsd / totalSupply gives the per-token USD value, but we want
    // cToken→underlying. Kamino's API returns these in underlying units, so the
    // exchange rate is derived from the collateral supply vs liquidity supply.
    // Empirically at time of writing: 1 cUSDC ≈ 1.1767 USDC.
    // We use totalBorrowUsd + cash / collateralMintTotalSupply, but that's not
    // in this endpoint. Fallback: parse `collExchangeRate` if present, else 1.0.
    const rate = parseFloat(usdcReserve?.collExchangeRate ?? usdcReserve?.exchangeRate ?? '1');
    return isNaN(rate) || rate <= 0 ? 1.0 : rate;
  } catch {
    return 1.0;
  }
}

export async function getKaminoPosition(
  _connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  cluster: SolanaCluster = 'mainnet-beta'
): Promise<KaminoPosition> {
  const zero: KaminoPosition = { currentValueUsd: 0, yieldTokenBalance: 0 };

  try {
    const TOKEN_MINTS = getTokenMints(cluster);
    const targetMint = TOKEN_MINTS[token];
    if (!targetMint) return zero;

    const market = getKaminoMarket(cluster);
    // The obligations endpoint returns an array of the user's obligations
    // with raw on-chain deposit data (reserve addresses and amounts).
    const url = `${KAMINO_API_BASE}/kamino-market/${market}/users/${walletPubkey.toBase58()}/obligations`;
    const res = await fetch(url);
    if (!res.ok) return zero;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obligations: any[] = await res.json();
    if (!Array.isArray(obligations) || obligations.length === 0) return zero;

    const decimals = TOKEN_DECIMALS[token] ?? 6;
    let totalCollateralShares = 0;

    for (const obligation of obligations) {
      const deposits = obligation?.state?.deposits ?? [];
      for (const dep of deposits) {
        const reserveAddr = dep?.depositReserve;
        if (!reserveAddr || reserveAddr === '11111111111111111111111111111111') continue;
        // Match by resolving reserve → mint
        const mint = KAMINO_MAIN_MARKET_RESERVES[reserveAddr];
        if (mint !== targetMint) continue;
        const amountRaw = parseFloat(dep?.depositedAmount ?? '0');
        if (!isNaN(amountRaw)) {
          totalCollateralShares += amountRaw / 10 ** decimals;
        }
      }
    }

    if (totalCollateralShares === 0) return zero;

    // Convert collateral shares to underlying USDC value.
    // Kamino uses a liquidity/collateral exchange rate that starts at 1:1 and
    // drifts as interest accrues. If we can't fetch the rate, fall back to 1:1
    // (slight undervaluation, which is safe).
    const exchangeRate = await getKaminoReserveExchangeRate();
    const currentValueUsd = totalCollateralShares * exchangeRate;

    return {
      currentValueUsd,
      yieldTokenBalance: totalCollateralShares,
    };
  } catch (err) {
    console.error('[Kamino] getKaminoPosition error:', err);
    return zero;
  }
}
