import { z } from 'zod';

export const recordPendingDepositInputSchema = z.object({
  protocol: z.string().min(1),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  chain: z.enum(['ethereum', 'solana']),
  txHash: z.string().min(1),
});

export type RecordPendingDepositInput = z.infer<typeof recordPendingDepositInputSchema>;
