'use client';

import { useState, useCallback } from 'react';
import { usePublicClient, useWriteContract } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/toast';
import { needsApproval, buildApproveArgs } from '@/lib/yield/contracts/allowance';
import { buildDepositTx } from '@/lib/yield/contracts/deposit';
import { PROTOCOL_ADDRESSES } from '@/lib/yield/contracts/addresses';
import type { YieldProtocolId } from '@/lib/yield/interface';

export type DepositStep =
  | 'idle'
  | 'checking'
  | 'approving'
  | 'approved'
  | 'depositing'
  | 'confirming'
  | 'done'
  | 'error';

export interface OnChainDepositParams {
  protocol: YieldProtocolId;
  token: string;
  amount: string;
  walletAddress: `0x${string}`;
  chain: string;
}

export function useOnChainDeposit() {
  const [step, setStep] = useState<DepositStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { toast } = useToast();

  const execute = useCallback(
    async ({ protocol, token, amount, walletAddress, chain }: OnChainDepositParams) => {
      if (!publicClient) {
        setError('No public client available');
        setStep('error');
        return;
      }

      const config = PROTOCOL_ADDRESSES[protocol];
      if (!config) {
        setError(`No contract addresses configured for protocol: ${protocol}`);
        setStep('error');
        return;
      }

      try {
        // Step 1: Check allowance
        setStep('checking');
        const approvalNeeded = await needsApproval(
          publicClient,
          token,
          walletAddress,
          config.spender,
          amount
        );

        // Step 2: Approve if needed
        if (approvalNeeded) {
          setStep('approving');
          const approveArgs = buildApproveArgs(token, config.spender, amount);
          const approveTxHash = await writeContractAsync(approveArgs);
          await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
          setStep('approved');
        }

        // Step 3: Deposit
        setStep('depositing');
        const depositArgs = buildDepositTx(protocol, token, amount, walletAddress);
        const depositTxHash = await writeContractAsync(depositArgs);
        setTxHash(depositTxHash);

        // Step 4: Wait for confirmation
        setStep('confirming');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTxHash });
        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted on-chain');
        }

        // Step 5: Notify backend
        const res = await fetch('/api/yield/confirm-deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocol,
            token,
            amount,
            walletAddress,
            chain,
            txHash: depositTxHash,
            blockNumber: receipt.blockNumber?.toString(),
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? 'Failed to confirm deposit with backend');
        }

        // Step 6: Invalidate caches
        queryClient.invalidateQueries({ queryKey: ['yield-positions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['yield-transactions', session?.user?.id] });
        queryClient.invalidateQueries({ queryKey: ['treasury-overview', session?.user?.id] });

        // Step 7: Done
        setStep('done');
        toast({ title: 'Deposit confirmed', description: `${amount} ${token} deposited successfully.` });
      } catch (err: unknown) {
        const errObj = err as { shortMessage?: string; message?: string };
        const message = errObj?.shortMessage ?? errObj?.message ?? 'Unknown error';
        setError(message);
        setStep('error');
        toast({ title: 'Deposit failed', description: message, variant: 'destructive' });
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
