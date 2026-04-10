import {
  PublicKey,
  Transaction,
  type Connection,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
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

/**
 * Builds a Solana transaction that transfers SPL tokens from the sender's
 * associated token account to the recipient's associated token account.
 *
 * Throws a clear error if the recipient doesn't have an ATA yet — caller
 * should surface this to the user (creating the ATA on the recipient's
 * behalf is a follow-up feature).
 */
export async function buildSplTokenTransferTx(params: {
  connection: Connection;
  senderPublicKey: PublicKey;
  recipientAddress: string;
  token: SupportedSolanaToken;
  amountDecimal: string;
  cluster: SolanaCluster;
}): Promise<Transaction> {
  const { connection, senderPublicKey, recipientAddress, token, amountDecimal, cluster } = params;

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

  // Verify recipient ATA exists (fail fast with clear error)
  try {
    await getAccount(connection, recipientAta);
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) {
      throw new Error(
        `Recipient does not have a ${token} token account. They must receive ${token} at least once before you can send to this address.`,
      );
    }
    throw err;
  }

  const transferIx = createTransferCheckedInstruction(
    senderAta,
    mintPubkey,
    recipientAta,
    senderPublicKey,
    rawAmount,
    decimals,
  );

  const tx = new Transaction().add(transferIx);
  return tx;
}
