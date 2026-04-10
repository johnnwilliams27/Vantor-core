'use client';

import { useState, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { useTestMode } from '@/hooks/useTestMode';
import {
  buildSplTokenTransferTx,
  checkRecipientAtaStatus,
  TOKEN_ACCOUNT_RENT_SOL,
  type SupportedSolanaToken,
} from '@/lib/transfers/contracts/solana';
import type { SolanaCluster } from '@/lib/yield/contracts/solana/cluster';

export type SolanaTransferStep =
  | 'idle'
  | 'checking'
  | 'needs_ata_confirmation'
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

export interface PendingAtaConfirmation {
  token: SupportedSolanaToken;
  rentSol: number;
}

export function useSolanaTransfer() {
  const [step, setStep] = useState<SolanaTransferStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pendingAtaConfirmation, setPendingAtaConfirmation] =
    useState<PendingAtaConfirmation | null>(null);

  // Remember the most recent params so confirmAta() can resume execution
  // after the user accepts the rent-fee disclosure.
  const lastParamsRef = useRef<SolanaTransferParams | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();
  const { testMode } = useTestMode();
  const cluster: SolanaCluster = testMode ? 'devnet' : 'mainnet-beta';

  const runTransfer = useCallback(
    async (params: SolanaTransferParams, allowCreateRecipientAta: boolean) => {
      if (!publicKey) {
        setError('Wallet not connected');
        setStep('error');
        return;
      }

      try {
        // Build SPL token transfer transaction
        setStep('building');
        const { tx } = await buildSplTokenTransferTx({
          connection,
          senderPublicKey: publicKey,
          recipientAddress: params.toAddress,
          token: params.token,
          amountDecimal: params.amount,
          cluster,
          allowCreateRecipientAta,
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
            transferId: params.transferId,
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
          description: `${params.amount} ${params.token} sent successfully.`,
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

  const execute = useCallback(
    async (params: SolanaTransferParams) => {
      if (!publicKey) {
        setError('Wallet not connected');
        setStep('error');
        return;
      }

      lastParamsRef.current = params;

      try {
        // Pre-check: does the recipient already have a token account?
        setStep('checking');
        const status = await checkRecipientAtaStatus({
          connection,
          recipientAddress: params.toAddress,
          token: params.token,
          cluster,
        });

        if (!status.exists) {
          // Pause and ask the user to accept the rent fee before signing.
          setPendingAtaConfirmation({
            token: params.token,
            rentSol: TOKEN_ACCOUNT_RENT_SOL,
          });
          setStep('needs_ata_confirmation');
          return;
        }

        // Recipient already has an ATA — proceed normally.
        await runTransfer(params, false);
      } catch (err: unknown) {
        const errObj = err as { shortMessage?: string; message?: string };
        const message = errObj?.shortMessage ?? errObj?.message ?? 'Unknown error';
        setError(message);
        setStep('error');
        toast({ title: 'Transfer failed', description: message, variant: 'destructive' });
      }
    },
    [publicKey, connection, cluster, runTransfer, toast],
  );

  const confirmAta = useCallback(async () => {
    const params = lastParamsRef.current;
    if (!params) return;
    setPendingAtaConfirmation(null);
    await runTransfer(params, true);
  }, [runTransfer]);

  const cancelAta = useCallback(() => {
    setPendingAtaConfirmation(null);
    lastParamsRef.current = null;
    setStep('idle');
  }, []);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
    setPendingAtaConfirmation(null);
    lastParamsRef.current = null;
  }, []);

  return {
    step,
    error,
    txHash,
    pendingAtaConfirmation,
    execute,
    confirmAta,
    cancelAta,
    reset,
  };
}
