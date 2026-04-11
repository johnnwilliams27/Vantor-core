import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../helpers/test-db';
import { ObligationsRepo } from '@/lib/obligations/repo';
import type { ObligationInput } from '@/lib/obligations/types';

describe('ObligationsRepo', () => {
  const db = getTestDb();
  let repo: ObligationsRepo;
  let enterpriseId: string;
  let userId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    userId = ctx.userId;
    cleanup = ctx.cleanup;
    repo = new ObligationsRepo(db);
  });

  afterAll(async () => {
    await cleanup();
  });

  const sample: ObligationInput = {
    label: 'Q2 Payroll',
    direction: 'outflow',
    amount: 50000,
    currency: 'USD',
    dueDate: '2026-05-01',
    confidence: 'confirmed',
    recurrence: 'monthly',
  };

  it('create → persisted with enterprise_id and defaults', async () => {
    const created = await repo.create(enterpriseId, userId, sample);
    expect(created.id).toBeDefined();
    expect(created.enterpriseId).toBe(enterpriseId);
    expect(created.userId).toBe(userId);
    expect(created.status).toBe('upcoming');
    expect(created.source).toBe('manual');
    expect(created.recurrence).toBe('monthly');
    expect(created.amount).toBe(50000);
  });

  it('listUpcoming filters by status and window', async () => {
    await repo.create(enterpriseId, userId, { ...sample, label: 'In window', dueDate: '2026-05-20' });
    await repo.create(enterpriseId, userId, { ...sample, label: 'Out of window', dueDate: '2027-01-01' });
    const out = await repo.listUpcoming(enterpriseId, new Date('2026-04-10'), new Date('2026-06-30'));
    const labels = out.map((o) => o.label);
    expect(labels).toContain('In window');
    expect(labels).not.toContain('Out of window');
  });

  it('patch updates fields and refreshes updated_at', async () => {
    const created = await repo.create(enterpriseId, userId, sample);
    // Force a clock tick so updated_at is observably different even on fast runs.
    await new Promise((r) => setTimeout(r, 10));
    const patched = await repo.patch(enterpriseId, created.id, { amount: 60000 });
    expect(patched.amount).toBe(60000);
    expect(patched.updatedAt).not.toBe(created.updatedAt);
  });

  it('markPaid transitions status and sets settlement ref', async () => {
    const created = await repo.create(enterpriseId, userId, sample);
    const paid = await repo.markPaid(enterpriseId, created.id, 'transfer_abc123');
    expect(paid.status).toBe('paid');
    expect(paid.settlementTxRef).toBe('transfer_abc123');
    expect(paid.paidAt).not.toBeNull();
  });

  it('delete removes the row', async () => {
    const created = await repo.create(enterpriseId, userId, sample);
    await repo.delete(enterpriseId, created.id);
    await expect(repo.getById(enterpriseId, created.id)).rejects.toThrow(/not found/i);
  });
});
