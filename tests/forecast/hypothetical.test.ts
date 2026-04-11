import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { createForecastService } from '@/lib/forecast/service';
import { ObligationsRepo } from '@/lib/obligations/repo';

describe('ForecastService.hypothetical', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let userId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    userId = ctx.userId;
    cleanup = ctx.cleanup;
    const repo = new ObligationsRepo(db);
    await repo.create(enterpriseId, userId, {
      label: 'Payroll',
      direction: 'outflow',
      amount: 10000,
      currency: 'USD',
      dueDate: '2026-05-01',
      confidence: 'confirmed',
      recurrence: 'once',
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('hypothetical call does not mutate the original service', async () => {
    const svc = await createForecastService({
      enterpriseId,
      db,
      consumer: 'rules_engine',
    });
    const originalBefore = await svc.getProjectedMinBalance('USD', null, 90);

    const hypo = svc.hypothetical([
      { amount: 50000, asset: 'USDC', fromVenue: null, toVenue: 'wallet_x' }, // inflow
    ]);
    await hypo.getProjectedMinBalance('USD', null, 90);

    const originalAfter = await svc.getProjectedMinBalance('USD', null, 90);
    expect(originalAfter.amount).toBe(originalBefore.amount);
    expect(originalAfter.date).toBe(originalBefore.date);
  });

  it('hypothetical does NOT persist unless explicitly told to', async () => {
    const svc = await createForecastService({
      enterpriseId,
      db,
      consumer: 'rules_engine',
    });
    const before = await db
      .from('forecast_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('enterprise_id', enterpriseId);

    const hypo = svc.hypothetical([
      { amount: 1000, asset: 'USD', fromVenue: 'ba_1', toVenue: null }, // outflow
    ]);
    await hypo.areObligationsCovered(90);

    const after = await db
      .from('forecast_snapshots')
      .select('id', { count: 'exact', head: true })
      .eq('enterprise_id', enterpriseId);
    expect(after.count).toBe(before.count);
  });
});
