import { describe, it, expect } from 'vitest';
import { ForecastEngine } from '@/lib/forecast/engine';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';
import type { Obligation } from '@/lib/obligations/types';

function emptyState(overrides: Partial<TreasuryStateSnapshot> = {}): TreasuryStateSnapshot {
  return {
    id: 's', enterpriseId: 'e', takenAt: '2026-04-10T00:00:00Z', takenBy: null,
    trigger: 'on_demand', baseCurrency: 'USD',
    totalValueBaseUsd: 100000, totalFiatBaseUsd: 100000,
    totalStablecoinBaseUsd: 0, totalDefiBaseUsd: 0,
    positions: {
      bankAccounts: [{ accountId: 'ba_1', currency: 'USD', balanceNative: 100000, balanceBaseUsd: 100000, balanceAsOf: null }],
      wallets: [], defiPositions: [], pendingTransfers: [],
    },
    fxRates: {},
    ...overrides,
  };
}

function obligation(o: Partial<Obligation>): Obligation {
  return {
    id: 'ob', enterpriseId: 'e', userId: 'u', label: 'x', description: null,
    direction: 'outflow', amount: 0, currency: 'USD', asset: null,
    dueDate: '2026-04-15',
    sourceAccountId: null, sourceVenueKind: null,
    confidence: 'confirmed', source: 'manual', status: 'upcoming',
    recurrence: 'once', recurrenceCron: null,
    counterpartyId: null, erpReference: null, recurringParentId: null,
    tags: [], metadata: {}, paidAt: null, settlementTxRef: null, isActive: true,
    createdAt: '', updatedAt: '',
    ...o,
  };
}

describe('ForecastEngine.project', () => {
  const engine = new ForecastEngine();
  const from = new Date('2026-04-10T00:00:00Z');

  it('empty obligations: balance flat across window', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.daily).toHaveLength(31); // day 0 through day 30
    expect(proj.daily[0].totalBaseUsd).toBe(100000);
    expect(proj.daily[30].totalBaseUsd).toBe(100000);
    expect(proj.covered).toBe(true);
    expect(proj.shortfalls).toEqual([]);
    expect(proj.minBalance.totalBaseUsd).toBe(100000);
  });

  it('single outflow reduces balance on due date and afterward', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', amount: 30000, dueDate: '2026-04-20' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.daily[9].totalBaseUsd).toBe(100000);  // day before
    expect(proj.daily[10].totalBaseUsd).toBe(70000);  // due date: 2026-04-20
    expect(proj.daily[30].totalBaseUsd).toBe(70000);
    expect(proj.covered).toBe(true);
  });

  it('outflow exceeding balance produces shortfall and covered=false', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', amount: 150000, dueDate: '2026-04-15' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.covered).toBe(false);
    expect(proj.shortfalls).toHaveLength(1);
    expect(proj.shortfalls[0].date).toBe('2026-04-15');
    expect(proj.shortfalls[0].deficitAmount).toBe(50000);
    expect(proj.minBalance.totalBaseUsd).toBe(-50000);
  });

  it('confidence filter excludes expected when includeExpected=false', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [
        obligation({ id: 'o1', amount: 30000, confidence: 'confirmed', dueDate: '2026-04-15' }),
        obligation({ id: 'o2', amount: 50000, confidence: 'expected', dueDate: '2026-04-20' }),
      ],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: false, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    // Only the confirmed $30k hits
    expect(proj.daily[30].totalBaseUsd).toBe(70000);
  });

  it('inflow obligation adds to balance', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', direction: 'inflow', amount: 50000, dueDate: '2026-04-15' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    expect(proj.daily[30].totalBaseUsd).toBe(150000);
  });

  it('extraDrawdownPct applies a day-0 haircut', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 20, fxStrategy: 'current' },
    });
    // 100k - 20% = 80k, flat thereafter
    expect(proj.daily[0].totalBaseUsd).toBe(80000);
    expect(proj.daily[30].totalBaseUsd).toBe(80000);
  });

  it('EUR obligation against USD balance uses FX rate at projection time', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [obligation({ id: 'o1', amount: 50000, currency: 'EUR', dueDate: '2026-04-15' })],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1, 'EUR->USD': 1.10 }, // 1 EUR = 1.10 USD
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    // 50k EUR = 55k USD outflow
    expect(proj.daily[30].totalBaseUsd).toBe(45000);
  });

  it('minBalance finds the lowest point and its date', () => {
    const proj = engine.project({
      state: emptyState(),
      obligations: [
        obligation({ id: 'o1', amount: 30000, dueDate: '2026-04-15' }),
        obligation({ id: 'o2', amount: 50000, dueDate: '2026-04-25' }),
        obligation({ id: 'o3', direction: 'inflow', amount: 40000, dueDate: '2026-05-05' }),
      ],
      from, windowDays: 30,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: { includeExpected: true, includeEstimated: false, extraDrawdownPct: 0, fxStrategy: 'current' },
    });
    // 100k -> 70k (day 5) -> 20k (day 15) -> 60k (day 25)
    expect(proj.minBalance.totalBaseUsd).toBe(20000);
    expect(proj.minBalance.date).toBe('2026-04-25');
  });
});
