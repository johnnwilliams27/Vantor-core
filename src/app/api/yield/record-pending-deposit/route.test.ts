import { describe, it, expect } from 'vitest';
import { recordPendingDepositInputSchema } from './schema';

describe('recordPendingDepositInputSchema', () => {
  const base = {
    protocol: 'compound_v3',
    token: 'USDC',
    amount: '10',
    walletAddress: '0x51e048a166D22e2898790a4806652bCFf6F03A36',
    chain: 'ethereum',
    txHash: '0xabc123',
  };

  it('accepts minimal client payload', () => {
    expect(recordPendingDepositInputSchema.safeParse(base).success).toBe(true);
  });

  it('rejects missing txHash', () => {
    expect(
      recordPendingDepositInputSchema.safeParse({ ...base, txHash: '' }).success,
    ).toBe(false);
  });

  it('rejects unknown chain', () => {
    expect(
      recordPendingDepositInputSchema.safeParse({ ...base, chain: 'polygon' }).success,
    ).toBe(false);
  });

  it('rejects non-positive amount', () => {
    expect(
      recordPendingDepositInputSchema.safeParse({ ...base, amount: '0' }).success,
    ).toBe(false);
  });
});
