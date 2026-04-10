'use client';

import { useState, useCallback } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { buildErc20TransferArgs, type SupportedEvmToken } from '@/lib/transfers/contracts/evm';

export type TransferStep =
  | 'idle'
  | 'signing'
  | 'confirming'
  | 'recording'
  | 'done'
  | 'error';

export interface OnChainTransferParams {
  transferId: string;
  token: SupportedEvmToken;
  amount: string;
  toAddress: string;
  fromAddress: `0x${string}`;
}

export function useOnChainTransfer() {
  const [step, setStep] = useState<TransferStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();

  const execute = useCallback(
    async ({ transferId, token, amount, toAddress, fromAddress }: OnChainTransferParams) => {
      if (!publicClient) {
        setError('No public client available');
        setStep('error');
        return;
      }

      try {
        // Build transfer args — throws early on invalid address/amount
        const transferArgs = buildErc20TransferArgs(token, toAddress, amount);

        // Ask the user to sign in their wallet
        setStep('signing');
        const submittedTxHash = await writeContractAsync({
          ...transferArgs,
          account: fromAddress,
        });
        setTxHash(submittedTxHash);

        // Wait for on-chain confirmation
        setStep('confirming');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedTxHash });
        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted on-chain');
        }

        // Record the completed transfer with the backend
        setStep('recording');
        const res = await fetch('/api/transfers/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transferId,
            txHash: submittedTxHash,
            blockNumber: receipt.blockNumber?.toString(),
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
    [publicClient, writeContractAsync, queryClient, session?.user?.id, toast],
  );

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  return { step, error, txHash, execute, reset };
}
