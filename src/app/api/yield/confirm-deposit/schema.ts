import { z } from 'zod';

export const confirmDepositInputSchema = z.object({
  protocol: z.string().min(1),
  token: z.enum(['USDC', 'USDT']),
  amount: z.string().min(1).refine((v) => parseFloat(v) > 0, 'Amount must be positive'),
  walletAddress: z.string().min(1).max(100),
  chain: z.enum(['ethereum', 'solana']),
  txHash: z.string().min(1),
  yieldToken: z.string().min(1).optional(),
  tokensReceived: z.number().positive().optional(),
});

export type ConfirmDepositInput = z.infer<typeof confirmDepositInputSchema>;
