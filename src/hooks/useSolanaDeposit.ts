'use client';

import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import type { YieldProtocolId } from '@/lib/yield/interface';
import { useTestMode } from '@/hooks/useTestMode';
import type { SolanaCluster } from '@/lib/yield/contracts/solana/cluster';

export type SolanaDepositStep =
  | 'idle'
  | 'building'
  | 'signing'
  | 'confirming'
  | 'recording'
  | 'done'
  | 'error';

export interface SolanaDepositParams {
  protocol: YieldProtocolId;
  token: string;
  amount: string;
  walletAddress: string;
  chain: string;
}

export function useSolanaDeposit() {
  const [step, setStep] = useState<SolanaDepositStep>('idle');
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
    async ({ protocol, token, amount, walletAddress, chain }: SolanaDepositParams) => {
      if (!publicKey) {
        const message = 'Wallet not connected';
        setError(message);
        setStep('error');
        return { ok: false as const, error: message };
      }

      try {
        // Step 1: Build transaction
        setStep('building');
        let tx: import('@solana/web3.js').Transaction;

        if (protocol === 'kamino' || protocol === 'kamino_multiply') {
          // Kamino: always mainnet (no public devnet market available)
          const { buildKaminoDepositTx } = await import('@/lib/yield/contracts/solana/kamino');
          tx = await buildKaminoDepositTx(connection, publicKey, token, parseFloat(amount), 'mainnet-beta');
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

        // Record a pending row server-side immediately. If the browser crashes
        // during confirmTransaction, or confirm-deposit fails later, this row
        // plus the signature is enough for a reconcile job (or a human) to
        // resolve the position. Non-fatal — user already signed.
        try {
          await fetch('/api/yield/record-pending-deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              protocol,
              token,
              amount,
              walletAddress,
              chain,
              txHash: signature,
            }),
          });
        } catch (e) {
          console.warn('[yield-deposit] pending-record call failed (non-fatal)', e);
        }

        // Step 3: Confirm transaction
        setStep('confirming');
        await connection.confirmTransaction(signature, 'confirmed');

        // Step 4: Notify backend
        setStep('recording');
        const res = await fetch('/api/yield/confirm-deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocol,
            token,
            amount,
            walletAddress,
            chain,
            txHash: signature,
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? 'Failed to confirm deposit with backend');
        }

        // Step 5: Invalidate caches
        queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

        // Step 6: Done
        setStep('done');
        toast({ title: 'Deposit confirmed', description: `${amount} ${token} deposited successfully.` });
        return { ok: true as const };
      } catch (err: unknown) {
        const errObj = err as { shortMessage?: string; message?: string };
        const message = errObj?.shortMessage ?? errObj?.message ?? 'Unknown error';
        setError(message);
        setStep('error');
        toast({ title: 'Deposit failed', description: message, variant: 'destructive' });
        return { ok: false as const, error: message };
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
