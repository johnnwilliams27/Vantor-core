import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnterprise, getTestDb } from '../../helpers/test-db';
import { TreasuryStateService } from '@/lib/treasury/state/service';

describe('TreasuryStateService', () => {
  const db = getTestDb();
  let enterpriseId: string;
  let cleanup: () => Promise<void>;
  let svc: TreasuryStateService;

  beforeAll(async () => {
    const ctx = await createTestEnterprise(db);
    enterpriseId = ctx.enterpriseId;
    cleanup = ctx.cleanup;
    svc = new TreasuryStateService(db);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('computeSnapshot returns zero totals for an empty enterprise', async () => {
    const snap = await svc.computeSnapshot(enterpriseId, 'on_demand');
    expect(snap.totalValueBaseUsd).toBe(0);
    expect(snap.totalFiatBaseUsd).toBe(0);
    expect(snap.totalStablecoinBaseUsd).toBe(0);
    expect(snap.totalDefiBaseUsd).toBe(0);
    expect(snap.positions.bankAccounts).toEqual([]);
    expect(snap.positions.wallets).toEqual([]);
    expect(snap.positions.defiPositions).toEqual([]);
    expect(snap.positions.pendingTransfers).toEqual([]);
    expect(snap.baseCurrency).toBe('USD');
    expect(snap.fxRates).toBeDefined();
  });

  it('persistSnapshot writes and returns id; latest() returns it', async () => {
    const snap = await svc.computeSnapshot(enterpriseId, 'on_demand');
    const saved = await svc.persistSnapshot(snap, null);
    expect(saved.id).toBeDefined();
    expect(saved.takenAt).toBeDefined();

    const latest = await svc.latest(enterpriseId);
    expect(latest).not.toBeNull();
    expect(latest!.id).toBe(saved.id);
    expect(latest!.totalValueBaseUsd).toBe(0);
  });

  it('totals equal sum of position slices', async () => {
    const snap = await svc.computeSnapshot(enterpriseId, 'on_demand');
    const sum =
      snap.totalFiatBaseUsd + snap.totalStablecoinBaseUsd + snap.totalDefiBaseUsd;
    expect(Math.abs(snap.totalValueBaseUsd - sum)).toBeLessThan(0.01);
  });
});
