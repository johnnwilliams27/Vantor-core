import { describe, it, expect } from 'vitest';
import { StubForecastQuery, StubForecastQueryFactory } from './stub';
import { TestStubLogger } from './stub-logger';
import { ProposedMovement } from '../types/movement';

const makeMovement = (): ProposedMovement => ({
  id: 'mv-1',
  kind: 'crypto_transfer',
  source: { venue: 'ethereum', asset: 'USDC' },
  destination: { venue: 'solana', asset: 'USDC' },
  amount: { amount: '1000', asset: 'USDC' },
  initiator: { type: 'human', user_id: 'user-1' },
  requested_at: '2026-04-10T14:22:33.000Z',
});

describe('StubForecastQuery', () => {
  it('metadata reports mode=stub', () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);
    expect(q.metadata.mode).toBe('stub');
    expect(q.metadata.source).toBe('stub-pass-through');
    expect(q.metadata.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('FORECAST_STUB_MODE')]),
    );
  });

  it('getProjectedMinBalance returns a large permissive value and logs', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.getProjectedMinBalance('USDC', null, 14);

    expect(parseFloat(result.amount)).toBeGreaterThan(1e15);
    expect(result.asset).toBe('USDC');
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].method).toBe('getProjectedMinBalance');
  });

  it('getProjectedPosition returns permissive and logs', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.getProjectedPosition('USDT', 'ethereum', new Date());
    expect(parseFloat(result.amount)).toBeGreaterThan(1e15);
    expect(logger.calls).toHaveLength(1);
  });

  it('areObligationsCovered returns { covered: true } with zero obligations', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.areObligationsCovered(30);
    expect(result.covered).toBe(true);
    expect(result.obligations_checked).toBe(0);
    expect(result.obligations_uncovered).toBe(0);
    expect(result.shortfall_amount).toBeUndefined();
    expect(logger.calls).toHaveLength(1);
  });

  it('getObligationsDueInWindow returns empty array', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const result = await q.getObligationsDueInWindow(7);
    expect(result).toEqual([]);
    expect(logger.calls).toHaveLength(1);
  });

  it('hypothetical() returns a NEW query instance (not this)', () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const hypo = q.hypothetical(makeMovement());

    expect(hypo).not.toBe(q);
    expect(hypo).toBeInstanceOf(StubForecastQuery);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].method).toBe('hypothetical');
  });

  it('hypothetical() returns an independent instance (no mutation of original)', async () => {
    const logger = new TestStubLogger();
    const q = new StubForecastQuery('ent-1', logger);

    const hypo = q.hypothetical(makeMovement());
    await hypo.areObligationsCovered(14); // hits hypo, not q

    // Only the hypothetical call and the areObligationsCovered call
    expect(logger.calls.map((c) => c.method)).toEqual(['hypothetical', 'areObligationsCovered']);
  });
});

describe('StubForecastQueryFactory', () => {
  it('createForEnterprise returns a StubForecastQuery', async () => {
    const logger = new TestStubLogger();
    const factory = new StubForecastQueryFactory(logger);

    const q = await factory.createForEnterprise('ent-1');
    expect(q).toBeInstanceOf(StubForecastQuery);
  });
});
