import {
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getSolanaConnection } from './client';
import { SOL_TOKEN_ADDRESSES } from '@/types/blockchain';
import type { TokenSymbol } from '@/types/database';
import Big from 'big.js';
import bs58 from 'bs58';

const TOKEN_DECIMALS: Record<TokenSymbol, number> = {
  USDC: 6,
  USDT: 6,
  PYUSD: 6,
};

export async function transferSolanaToken(
  fromPrivateKeyBase58: string,
  toAddress: string,
  token: TokenSymbol,
  humanAmount: string
): Promise<string> {
  const connection = getSolanaConnection();
  const fromKeypair = Keypair.fromSecretKey(bs58.decode(fromPrivateKeyBase58));
  const toPubkey = new PublicKey(toAddress);
  const mintPubkey = new PublicKey(SOL_TOKEN_ADDRESSES[token]);

  const decimals = TOKEN_DECIMALS[token];
  const rawAmount = BigInt(
    new Big(humanAmount).times(new Big(10).pow(decimals)).toFixed(0)
  );

  const fromAta = await getAssociatedTokenAddress(mintPubkey, fromKeypair.publicKey);
  const toAta = await getAssociatedTokenAddress(mintPubkey, toPubkey);

  const tx = new Transaction();

  // Create destination ATA if it doesn't exist
  try {
    await getAccount(connection, toAta);
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        fromKeypair.publicKey,
        toAta,
        toPubkey,
        mintPubkey
      )
    );
  }

  tx.add(
    createTransferInstruction(
      fromAta,
      toAta,
      fromKeypair.publicKey,
      rawAmount,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [fromKeypair]);
  return sig;
}
