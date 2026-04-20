import { describe, it, expect } from 'vitest';
import { confirmDepositInputSchema } from './schema';
import { decideExistingTxAction } from './promote';

describe('confirmDepositInputSchema', () => {
  const base = {
    protocol: 'compound_v3',
    token: 'USDC',
    amount: '10',
    walletAddress: '0x51e048a166D22e2898790a4806652bCFf6F03A36',
    chain: 'ethereum',
    txHash: '0xabc',
  };

  it('accepts the minimal client payload without yieldToken/tokensReceived', () => {
    const res = confirmDepositInputSchema.safeParse(base);
    expect(res.success).toBe(true);
  });

  it('accepts the full payload when client does send yieldToken/tokensReceived', () => {
    const res = confirmDepositInputSchema.safeParse({
      ...base,
      yieldToken: 'cUSDCv3',
      tokensReceived: 10.1,
    });
    expect(res.success).toBe(true);
  });

  it('rejects missing amount', () => {
    const res = confirmDepositInputSchema.safeParse({ ...base, amount: undefined });
    expect(res.success).toBe(false);
  });

  it('rejects non-positive amount', () => {
    const res = confirmDepositInputSchema.safeParse({ ...base, amount: '0' });
    expect(res.success).toBe(false);
  });
});

describe('decideExistingTxAction', () => {
  it('promotes when status is pending', () => {
    expect(decideExistingTxAction({ id: 't1', status: 'pending' })).toEqual({
      kind: 'promote',
      txId: 't1',
    });
  });

  it('409s when status is completed', () => {
    expect(decideExistingTxAction({ id: 't1', status: 'completed' })).toEqual({
      kind: 'conflict',
    });
  });

  it('409s when status is failed', () => {
    expect(decideExistingTxAction({ id: 't1', status: 'failed' })).toEqual({
      kind: 'conflict',
    });
  });

  it('treats no existing row as insert', () => {
    expect(decideExistingTxAction(null)).toEqual({ kind: 'insert' });
  });
});
