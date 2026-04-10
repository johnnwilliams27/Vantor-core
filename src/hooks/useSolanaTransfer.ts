'use client';

import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { useTestMode } from '@/hooks/useTestMode';
import { buildSplTokenTransferTx, type SupportedSolanaToken } from '@/lib/transfers/contracts/solana';
import type { SolanaCluster } from '@/lib/yield/contracts/solana/cluster';

export type SolanaTransferStep =
  | 'idle'
  | 'building'
  | 'signing'
  | 'confirming'
  | 'recording'
  | 'done'
  | 'error';

export interface SolanaTransferParams {
  transferId: string;
  token: SupportedSolanaToken;
  amount: string;
  toAddress: string;
}

export function useSolanaTransfer() {
  const [step, setStep] = useState<SolanaTransferStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { testMode } = useTestMode();
  const cluster: SolanaCluster = testMode ? 'devnet' : 'mainnet-beta';

  const execute = useCallback(
    async ({ transferId, token, amount, toAddress }: SolanaTransferParams) => {
      if (!publicKey) {
        setError('Wallet not connected');
        setStep('error');
        return;
      }

      try {
        // Build SPL token transfer transaction
        setStep('building');
        const tx = await buildSplTokenTransferTx({
          connection,
          senderPublicKey: publicKey,
          recipientAddress: toAddress,
          token,
          amountDecimal: amount,
          cluster,
        });

        // Attach blockhash and fee payer, then sign & send
        setStep('signing');
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        const signature = await sendTransaction(tx, connection);
        setTxHash(signature);

        // Confirm on-chain
        setStep('confirming');
        await connection.confirmTransaction(signature, 'confirmed');

        // Record with backend
        setStep('recording');
        const res = await fetch('/api/transfers/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transferId,
            txHash: signature,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? 'Failed to record transfer with backend');
        }

        // Invalidate caches
        queryClient.invalidateQueries({ queryKey: ['transfers'] });
        queryClient.invalidateQueries({ queryKey: ['transfers-volume'] });
        queryClient.invalidateQueries({ queryKey: ['balances'] });
        queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

        setStep('done');
        toast({
          title: 'Transfer confirmed',
          description: `${amount} ${token} sent successfully.`,
          variant: 'success',
        });
      } catch (err: unknown) {
        const errObj = err as { shortMessage?: string; message?: string };
        const message = errObj?.shortMessage ?? errObj?.message ?? 'Unknown error';
        setError(message);
        setStep('error');
        toast({ title: 'Transfer failed', description: message, variant: 'destructive' });
      }
    },
    [connection, publicKey, sendTransaction, queryClient, session?.user?.id, toast, cluster],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  return { step, error, txHash, execute, reset };
}
