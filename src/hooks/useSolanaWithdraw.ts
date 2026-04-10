'use client';

import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { useTestMode } from '@/hooks/useTestMode';
import type { SolanaCluster } from '@/lib/yield/contracts/solana/cluster';

export type SolanaWithdrawStep =
  | 'idle'
  | 'building'
  | 'signing'
  | 'confirming'
  | 'recording'
  | 'done'
  | 'error';

export interface SolanaWithdrawParams {
  positionId: string;
  protocol: YieldProtocolId;
  token: string;
  amount: string;
  walletAddress: string;
  isFullWithdrawal: boolean;
}

export function useSolanaWithdraw() {
  const [step, setStep] = useState<SolanaWithdrawStep>('idle');
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
    async ({ positionId, protocol, token, amount, walletAddress, isFullWithdrawal }: SolanaWithdrawParams) => {
      if (!publicKey) {
        setError('Wallet not connected');
        setStep('error');
        return;
      }

      try {
        // Step 1: Build transaction
        setStep('building');
        let tx: import('@solana/web3.js').Transaction;

        if (protocol === 'kamino' || protocol === 'kamino_multiply') {
          // Kamino: always mainnet (no public devnet market available)
          const { buildKaminoWithdrawTx } = await import('@/lib/yield/contracts/solana/kamino');
          tx = await buildKaminoWithdrawTx(connection, publicKey, token, parseFloat(amount), isFullWithdrawal, 'mainnet-beta');
        } else if (protocol === 'drift') {
          // Drift: supports devnet via SDK when test mode is on
          const { buildDriftWithdrawTx } = await import('@/lib/yield/contracts/solana/drift');
          tx = await buildDriftWithdrawTx(connection, publicKey, token, parseFloat(amount), isFullWithdrawal, cluster);
        } else {
          throw new Error(`Unsupported Solana protocol: ${protocol}`);
        }

        // Step 2: Set blockhash and fee payer, then sign & send
        setStep('signing');
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        const signature = await sendTransaction(tx, connection);
        setTxHash(signature);

        // Step 3: Confirm transaction
        setStep('confirming');
        await connection.confirmTransaction(signature, 'confirmed');

        // Step 4: Notify backend
        setStep('recording');
        const res = await fetch('/api/yield/confirm-withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            positionId,
            protocol,
            token,
            amount,
            walletAddress,
            isFullWithdrawal,
            txHash: signature,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? 'Failed to confirm withdrawal with backend');
        }

        // Step 5: Invalidate caches
        queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

        // Step 6: Done
        setStep('done');
        toast({ title: 'Withdrawal confirmed', description: `${amount} ${token} withdrawn successfully.` });
      } catch (err: unknown) {
        const errObj = err as { shortMessage?: string; message?: string };
        const message = errObj?.shortMessage ?? errObj?.message ?? 'Unknown error';
        setError(message);
        setStep('error');
        toast({ title: 'Withdrawal failed', description: message, variant: 'destructive' });
      }
    },
    [connection, publicKey, sendTransaction, queryClient, session?.user?.id, toast, cluster]
  );

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  return { step, error, txHash, execute, reset };
}
