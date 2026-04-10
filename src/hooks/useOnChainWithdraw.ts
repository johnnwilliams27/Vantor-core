'use client';

import { useState, useCallback } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { buildWithdrawTx } from '@/lib/yield/contracts/withdraw';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type WithdrawStep =
  | 'idle'
  | 'withdrawing'
  | 'confirming'
  | 'done'
  | 'error';

export interface OnChainWithdrawParams {
  positionId: string;
  protocol: YieldProtocolId;
  token: string;
  amount: string;
  walletAddress: `0x${string}`;
  isFullWithdrawal: boolean;
}

export function useOnChainWithdraw() {
  const [step, setStep] = useState<WithdrawStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();

  const execute = useCallback(
    async ({ positionId, protocol, token, amount, walletAddress, isFullWithdrawal }: OnChainWithdrawParams) => {
      if (!publicClient) {
        setError('No public client available');
        setStep('error');
        return;
      }

      try {
        // Step 1: Submit withdrawal transaction
        setStep('withdrawing');
        const withdrawArgs = buildWithdrawTx(protocol, token, amount, walletAddress, isFullWithdrawal);
        const withdrawTxHash = await writeContractAsync(withdrawArgs);
        setTxHash(withdrawTxHash);

        // Step 2: Wait for confirmation
        setStep('confirming');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTxHash });
        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted on-chain');
        }

        // Step 3: Notify backend
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
            txHash: withdrawTxHash,
            blockNumber: receipt.blockNumber?.toString(),
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? 'Failed to confirm withdrawal with backend');
        }

        // Step 4: Invalidate caches
        queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

        // Step 5: Done
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
    [publicClient, writeContractAsync, queryClient, session?.user?.id, toast]
  );

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(null);
  }, []);

  return { step, error, txHash, execute, reset };
}
