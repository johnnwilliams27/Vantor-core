import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { createForecastService } from '@/lib/forecast/service';
import { ObligationsRepo } from '@/lib/obligations/repo';

describe('ForecastService', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let cleanup: () => Promise<void>;
  // Per-run correlation id. The dev DB's audit_logs FK chain currently blocks
  // the test-db cleanup from cascading through forecast_snapshots, so using a
  // fixed literal here would collide with leftovers from a prior test run.
  // A unique suffix keeps the .single() lookup deterministic without touching
  // the T4 helper.
  const correlationId = `rules_eval_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    const userId = ctx.userId;
    cleanup = ctx.cleanup;

    const repo = new ObligationsRepo(db);
    await repo.create(enterpriseId, userId, {
      label: 'Q2 Payroll',
      direction: 'outflow',
      amount: 40000,
      currency: 'USD',
      dueDate: '2026-05-01',
      confidence: 'confirmed',
      recurrence: 'once',
    });
  });

  afterAll(async () => {
    // Best-effort: delete any forecast_snapshots this test wrote. The T4
    // cleanup helper can't reach them because the dev DB's audit_logs FK
    // blocks enterprise deletion from cascading. Explicit deletion keeps the
    // table from accumulating orphans across runs.
    await db.from('forecast_snapshots').delete().eq('correlation_id', correlationId);
    await cleanup();
  });

  it('getObligationsDueInWindow returns only the upcoming window', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'treasurer_view' });
    const obs = await svc.getObligationsDueInWindow(90);
    expect(obs.map(o => o.label)).toContain('Q2 Payroll');
  });

  it('areObligationsCovered returns covered=false when balance is empty', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'treasurer_view' });
    const res = await svc.areObligationsCovered(90);
    // Empty enterprise: balance is 0, there's a $40k outflow -> NOT covered
    expect(res.covered).toBe(false);
    expect(res.shortfallAmount).toBeGreaterThan(0);
  });

  it('getProjectedMinBalance returns a date and amount', async () => {
    const svc = await createForecastService({ enterpriseId, db, consumer: 'treasurer_view' });
    const out = await svc.getProjectedMinBalance('USD', null, 90);
    expect(out.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof out.amount).toBe('number');
  });

  it('persist=true writes a forecast_snapshots row with correlation_id', async () => {
    const svc = await createForecastService({
      enterpriseId,
      db,
      consumer: 'rules_engine',
      correlationId,
      persist: true,
    });
    await svc.areObligationsCovered(90);
    const { data } = await db
      .from('forecast_snapshots')
      .select('*')
      .eq('correlation_id', correlationId)
      .single();
    expect(data).not.toBeNull();
    expect(data!.consumer).toBe('rules_engine');
    expect(data!.is_hypothetical).toBe(false);
  });
});
