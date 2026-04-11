import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { ObligationsRepo } from '@/lib/obligations/repo';
import { materializeRecurringObligations } from '@/lib/obligations/materialize';

describe('materializeRecurringObligations', () => {
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
      label: 'Monthly Rent',
      direction: 'outflow',
      amount: 5000,
      currency: 'USD',
      dueDate: '2026-04-01',
      confidence: 'confirmed',
      recurrence: 'monthly',
    });
  });

  afterAll(async () => {
    await cleanup();
  });

  it('creates future instances up to 90 days out', async () => {
    const created = await materializeRecurringObligations(
      db,
      enterpriseId,
      new Date('2026-04-10T00:00:00Z'),
    );
    // From 2026-04-10 + 90 days = ~2026-07-09 window.
    // Monthly parent anchored 2026-04-01 → expandRecurrence yields
    // 2026-04-01 (= parent, skipped), 2026-05-01, 2026-06-01, 2026-07-01.
    // So at least 3 real new rows.
    expect(created.length).toBeGreaterThanOrEqual(3);

    const { data } = await db
      .from('obligations')
      .select('*')
      .eq('enterprise_id', enterpriseId)
      .not('recurring_parent_id', 'is', null);
    expect(data).not.toBeNull();
    expect(data!.length).toBe(created.length);
    for (const row of data!) {
      expect(row.recurrence).toBe('once'); // materialized instances are one-off
      expect(row.source).toBe('recurring_rule');
    }
  });

  it('is idempotent — running twice does not duplicate instances', async () => {
    const second = await materializeRecurringObligations(
      db,
      enterpriseId,
      new Date('2026-04-10T00:00:00Z'),
    );
    expect(second.length).toBe(0);
  });
});
