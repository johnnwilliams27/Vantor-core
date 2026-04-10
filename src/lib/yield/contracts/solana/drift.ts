/**
 * Drift Protocol instruction builders and position queries.
 *
 * The Drift SDK (@drift-labs/sdk) uses @solana/web3.js types throughout, so
 * it integrates cleanly with the rest of this codebase. The key classes are:
 *
 *   DriftClient   — main protocol client (requires a wallet / signer)
 *   User          — per-wallet state wrapper (exposes spot positions)
 *
 * Deposit / withdraw use:
 *   driftClient.getDepositInstruction(amount, marketIndex, ataAddress)
 *   driftClient.getWithdrawIx(amount, marketIndex, ataAddress)
 *
 * Because DriftClient requires an active subscription to load account state,
 * position queries fall back to the Drift public REST API when possible to
 * avoid subscribing a full client just for a read.
 *
 * Spot market indexes on mainnet-beta:
 *   0 → USDC   (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
 *   5 → USDT   (Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB)
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Drift mainnet-beta spot market indexes for supported stablecoins. */
const DRIFT_SPOT_MARKET_INDEX: Record<string, number> = {
  USDC: 0,
  USDT: 5,
};

/** Token decimals for amount conversion. */
const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
};

const DRIFT_REST_BASE = 'https://mainnet-beta.api.drift.trade';

// ─── Return types ────────────────────────────────────────────────────────────

export interface DriftPosition {
  currentValueUsd: number;
  yieldTokenBalance: number;
}

// ─── Minimal read-only wallet for DriftClient ────────────────────────────────

/**
 * DriftClient requires an IWallet in its config. For unsigned transaction
 * building we supply a read-only wallet — publicKey is real, sign methods
 * throw (they are never called when we only call getDepositInstruction /
 * getWithdrawIx).
 */
function makeReadOnlyWallet(pubkey: PublicKey) {
  return {
    publicKey: pubkey,
    signTransaction: async <T>(_tx: T): Promise<T> => {
      throw new Error('Read-only wallet cannot sign');
    },
    signAllTransactions: async <T>(txs: T[]): Promise<T[]> => {
      throw new Error('Read-only wallet cannot sign');
    },
  };
}

// ─── DriftClient factory ─────────────────────────────────────────────────────

/**
 * Construct and subscribe a DriftClient for the given wallet pubkey.
 * Returns the client; caller is responsible for calling client.unsubscribe()
 * when done.
 *
 * Notes on type casts:
 * - Drift SDK bundles its own copy of @solana/web3.js so the Connection types
 *   are nominally incompatible. We cast to `any` to bridge them.
 * - `programID` must be a PublicKey from the SDK's own web3.js copy.
 * - Polling subscription requires a BulkAccountLoader; we instantiate one
 *   with a 1-second polling frequency.
 */
async function buildDriftClient(connection: Connection, walletPubkey: PublicKey) {
  const {
    DriftClient,
    DRIFT_PROGRAM_ID,
    BulkAccountLoader,
  } = await import('@drift-labs/sdk');

  const wallet = makeReadOnlyWallet(walletPubkey);

  // BulkAccountLoader expects the SDK's internal Connection type; cast via any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountLoader = new BulkAccountLoader(connection as any, 'confirmed', 1000);

  const client = new DriftClient({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connection: connection as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: wallet as any,
    // DRIFT_PROGRAM_ID is a string constant; DriftClient also accepts a string.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    programID: DRIFT_PROGRAM_ID as any,
    env: 'mainnet-beta',
    accountSubscription: {
      type: 'polling',
      accountLoader,
    },
  });

  await client.subscribe();
  return client;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a Drift deposit transaction.
 *
 * @param connection  web3.js Connection to mainnet-beta.
 * @param walletPubkey  Depositor's public key.
 * @param token  "USDC" | "USDT".
 * @param amount  Amount in token units (e.g. 100 for 100 USDC).
 * @returns An unsigned legacy Transaction containing the deposit instruction
 *          (preceded by any setup instructions the SDK emits).
 */
export async function buildDriftDepositTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number
): Promise<Transaction> {
  const tx = new Transaction();

  try {
    const marketIndex = DRIFT_SPOT_MARKET_INDEX[token];
    if (marketIndex === undefined) throw new Error(`Unsupported token: ${token}`);

    const decimals = TOKEN_DECIMALS[token] ?? 6;
    const lamports = new BN(Math.round(amount * 10 ** decimals));

    // The deposit instruction requires the user's associated token account for
    // the given mint. We derive it here; the UI layer should ensure the ATA
    // exists before broadcasting.
    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const { MainnetSpotMarkets } = await import('@drift-labs/sdk');

    const mintConfig = MainnetSpotMarkets.find(
      (m) => m.marketIndex === marketIndex
    );
    if (!mintConfig) throw new Error('Mint config not found for market index');

    const ata = await getAssociatedTokenAddress(
      mintConfig.mint,
      walletPubkey,
      false
    );

    const client = await buildDriftClient(connection, walletPubkey);
    try {
      const ix: TransactionInstruction = await client.getDepositInstruction(
        lamports,
        marketIndex,
        ata,
        0, // subAccountId
        false // reduceOnly
      );
      tx.add(ix);
    } finally {
      await client.unsubscribe();
    }
  } catch (err) {
    console.error('[Drift] buildDriftDepositTx error:', err);
  }

  return tx;
}

/**
 * Build a Drift withdraw transaction.
 *
 * @param connection  web3.js Connection.
 * @param walletPubkey  Withdrawer's public key.
 * @param token  "USDC" | "USDT".
 * @param amount  Amount in token units (ignored when isFullWithdrawal=true).
 * @param isFullWithdrawal  When true, uses u64 max to signal full withdrawal.
 * @returns An unsigned legacy Transaction.
 */
export async function buildDriftWithdrawTx(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string,
  amount: number,
  isFullWithdrawal = false
): Promise<Transaction> {
  const tx = new Transaction();

  try {
    const marketIndex = DRIFT_SPOT_MARKET_INDEX[token];
    if (marketIndex === undefined) throw new Error(`Unsupported token: ${token}`);

    const decimals = TOKEN_DECIMALS[token] ?? 6;
    // u64 max signals "withdraw everything" to the Drift program.
    const lamports = isFullWithdrawal
      ? new BN('18446744073709551615')
      : new BN(Math.round(amount * 10 ** decimals));

    const { getAssociatedTokenAddress } = await import('@solana/spl-token');
    const { MainnetSpotMarkets } = await import('@drift-labs/sdk');

    const mintConfig = MainnetSpotMarkets.find(
      (m) => m.marketIndex === marketIndex
    );
    if (!mintConfig) throw new Error('Mint config not found for market index');

    const ata = await getAssociatedTokenAddress(
      mintConfig.mint,
      walletPubkey,
      false
    );

    const client = await buildDriftClient(connection, walletPubkey);
    try {
      // getWithdrawIx returns a single instruction; getWithdrawalIxs (plural)
      // returns an array — use the singular form for a simple withdrawal.
      const ix: TransactionInstruction = await client.getWithdrawIx(
        lamports,
        marketIndex,
        ata,
        false, // reduceOnly
        0 // subAccountId
      );
      tx.add(ix);
    } finally {
      await client.unsubscribe();
    }
  } catch (err) {
    console.error('[Drift] buildDriftWithdrawTx error:', err);
  }

  return tx;
}

/**
 * Query the current Drift spot lending position for a wallet + token.
 *
 * Tries the Drift REST API first (no subscription cost), then falls back
 * to the on-chain SDK if the REST call fails.
 *
 * REST endpoint:
 *   GET https://mainnet-beta.api.drift.trade/userPositions?userPublicKey={wallet}
 */
export async function getDriftPosition(
  connection: Connection,
  walletPubkey: PublicKey,
  token: string
): Promise<DriftPosition> {
  const zero: DriftPosition = { currentValueUsd: 0, yieldTokenBalance: 0 };

  try {
    const marketIndex = DRIFT_SPOT_MARKET_INDEX[token];
    if (marketIndex === undefined) return zero;

    // ── Try REST API first ────────────────────────────────────────────────
    try {
      const url = `${DRIFT_REST_BASE}/userPositions?userPublicKey=${walletPubkey.toBase58()}`;
      const res = await fetch(url, { next: { revalidate: 30 } } as RequestInit);

      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await res.json();

        // The response is typically:
        //   { spotPositions: [{ marketIndex, tokenAmount, usdValue, ... }] }
        // Field names may vary; probe multiple.
        const spots: unknown[] =
          data?.spotPositions ??
          data?.spot_positions ??
          data?.positions?.spot ??
          [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const match = (spots as any[]).find(
          (p) =>
            p?.marketIndex === marketIndex ||
            p?.market_index === marketIndex ||
            p?.spotMarketIndex === marketIndex
        );

        if (match) {
          const decimals = TOKEN_DECIMALS[token] ?? 6;
          const rawBalance = parseFloat(
            match.tokenAmount ?? match.token_amount ?? match.balance ?? '0'
          );
          const currentValueUsd = parseFloat(
            match.usdValue ?? match.usd_value ?? match.notionalValue ?? '0'
          );
          const yieldTokenBalance = isNaN(rawBalance)
            ? 0
            : rawBalance / 10 ** decimals;

          return {
            currentValueUsd: isNaN(currentValueUsd) ? 0 : currentValueUsd,
            yieldTokenBalance,
          };
        }

        // Wallet has no position in this market — return zero.
        return zero;
      }
    } catch (restErr) {
      console.warn('[Drift] REST API unavailable, falling back to SDK:', restErr);
    }

    // ── SDK fallback ──────────────────────────────────────────────────────
    const client = await buildDriftClient(connection, walletPubkey);
    try {
      const spotPos = client.getSpotPosition(marketIndex, 0);
      if (!spotPos) return zero;

      const decimals = TOKEN_DECIMALS[token] ?? 6;
      // scaledBalance is stored in SPOT_MARKET_BALANCE_PRECISION units (1e9).
      // Convert to token units by dividing by 1e9, then apply token decimals.
      const { SPOT_MARKET_BALANCE_PRECISION } = await import('@drift-labs/sdk');
      const balancePrecision = SPOT_MARKET_BALANCE_PRECISION
        ? SPOT_MARKET_BALANCE_PRECISION.toNumber()
        : 1e9;

      const tokenBalance =
        spotPos.scaledBalance.toNumber() / balancePrecision;
      const currentValueUsd = tokenBalance; // 1:1 for stables; no oracle call here

      return {
        currentValueUsd,
        yieldTokenBalance: tokenBalance / 10 ** (decimals - 6), // normalize
      };
    } finally {
      await client.unsubscribe();
    }
  } catch (err) {
    console.error('[Drift] getDriftPosition error:', err);
    return zero;
  }
}
