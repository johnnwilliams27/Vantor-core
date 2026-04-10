import {
  PublicKey,
  Transaction,
  type Connection,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { getTokenMints, type SolanaCluster } from '@/lib/yield/contracts/solana/cluster';

export type SupportedSolanaToken = 'USDC' | 'USDT';

// USDC and USDT on Solana both use 6 decimals.
const TOKEN_DECIMALS: Record<SupportedSolanaToken, number> = {
  USDC: 6,
  USDT: 6,
};

// Rent-exempt amount for an SPL token account (165 bytes + overhead).
// ~0.00203928 SOL on mainnet. Hardcoded to avoid a separate RPC call; the
// Solana rent sysvar value has been stable for years.
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;
export const TOKEN_ACCOUNT_RENT_SOL = TOKEN_ACCOUNT_RENT_LAMPORTS / 1_000_000_000;

/**
 * Lightweight precheck: resolves the recipient ATA and confirms whether it
 * already exists. Called from the UI BEFORE the user signs, so we can show a
 * Phantom-style "recipient needs an account, pay ~$0.40 rent to proceed"
 * disclosure when required.
 */
export async function checkRecipientAtaStatus(params: {
  connection: Connection;
  recipientAddress: string;
  token: SupportedSolanaToken;
  cluster: SolanaCluster;
}): Promise<{
  recipientAta: PublicKey;
  exists: boolean;
  rentLamports: number;
  rentSol: number;
}> {
  const { connection, recipientAddress, token, cluster } = params;

  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(recipientAddress);
  } catch {
    throw new Error(`Invalid Solana address: ${recipientAddress}`);
  }

  const mints = getTokenMints(cluster);
  const mintAddress = mints[token];
  if (!mintAddress) {
    throw new Error(`Unsupported token: ${token}`);
  }
  const mintPubkey = new PublicKey(mintAddress);
  const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

  let exists = true;
  try {
    await getAccount(connection, recipientAta);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      exists = false;
    } else {
      throw err;
    }
  }

  return {
    recipientAta,
    exists,
    rentLamports: exists ? 0 : TOKEN_ACCOUNT_RENT_LAMPORTS,
    rentSol: exists ? 0 : TOKEN_ACCOUNT_RENT_SOL,
  };
}

/**
 * Builds a Solana transaction that transfers SPL tokens from the sender's ATA
 * to the recipient's ATA.
 *
 * If the recipient ATA doesn't exist:
 *  - When `allowCreateRecipientAta` is true, prepends an idempotent ATA
 *    creation instruction. The sender pays rent (~0.002 SOL).
 *  - When `allowCreateRecipientAta` is false, throws a clear error so the
 *    caller can surface the Phantom-style confirmation dialog.
 */
export async function buildSplTokenTransferTx(params: {
  connection: Connection;
  senderPublicKey: PublicKey;
  recipientAddress: string;
  token: SupportedSolanaToken;
  amountDecimal: string;
  cluster: SolanaCluster;
  allowCreateRecipientAta?: boolean;
}): Promise<{ tx: Transaction; createdRecipientAta: boolean }> {
  const {
    connection,
    senderPublicKey,
    recipientAddress,
    token,
    amountDecimal,
    cluster,
    allowCreateRecipientAta = false,
  } = params;

  // Validate recipient
  let recipientPubkey: PublicKey;
  try {
    recipientPubkey = new PublicKey(recipientAddress);
  } catch {
    throw new Error(`Invalid Solana address: ${recipientAddress}`);
  }

  // Resolve mint for current cluster
  const mints = getTokenMints(cluster);
  const mintAddress = mints[token];
  if (!mintAddress) {
    throw new Error(`Unsupported token: ${token}`);
  }
  const mintPubkey = new PublicKey(mintAddress);

  const decimals = TOKEN_DECIMALS[token];

  // Parse amount to raw units
  const [whole, fractional = ''] = amountDecimal.split('.');
  const padded = (fractional + '0'.repeat(decimals)).slice(0, decimals);
  let rawAmount: bigint;
  try {
    rawAmount = BigInt(whole) * BigInt(10 ** decimals) + BigInt(padded || '0');
  } catch {
    throw new Error(`Invalid amount: ${amountDecimal}`);
  }
  if (rawAmount <= BigInt(0)) {
    throw new Error('Amount must be greater than zero');
  }

  // Derive ATAs
  const senderAta = await getAssociatedTokenAddress(mintPubkey, senderPublicKey);
  const recipientAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

  // Check whether recipient ATA needs to be created
  let recipientAtaExists = true;
  try {
    await getAccount(connection, recipientAta);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      recipientAtaExists = false;
    } else {
      throw err;
    }
  }

  if (!recipientAtaExists && !allowCreateRecipientAta) {
    throw new Error(
      `Recipient does not have a ${token} token account. A one-time ~${TOKEN_ACCOUNT_RENT_SOL} SOL rent fee is required to create one.`,
    );
  }

  const tx = new Transaction();
  let createdRecipientAta = false;

  if (!recipientAtaExists && allowCreateRecipientAta) {
    // Sender pays rent to create recipient's ATA. Idempotent so this is safe
    // even if another tx creates the same ATA in parallel.
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        senderPublicKey, // payer
        recipientAta, // new ATA address
        recipientPubkey, // owner
        mintPubkey, // mint
      ),
    );
    createdRecipientAta = true;
  }

  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      mintPubkey,
      recipientAta,
      senderPublicKey,
      rawAmount,
      decimals,
    ),
  );

  return { tx, createdRecipientAta };
}
