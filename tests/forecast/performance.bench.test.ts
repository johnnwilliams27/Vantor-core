import { describe, it, expect } from 'vitest';
import { ForecastEngine } from '@/lib/forecast/engine';
import type { Obligation } from '@/lib/obligations/types';
import type { TreasuryStateSnapshot } from '@/lib/treasury/state/types';

const TARGET_MS = 100;
const HARD_CEILING_MS = 1000;

function buildObligations(n: number): Obligation[] {
  const arr: Obligation[] = [];
  for (let i = 0; i < n; i++) {
    const dayOffset = i % 90;
    const date = new Date(Date.UTC(2026, 3, 10 + dayOffset)).toISOString().slice(0, 10);
    arr.push({
      id: `ob_${i}`,
      enterpriseId: 'e',
      userId: 'u',
      label: `Obligation ${i}`,
      description: null,
      direction: i % 3 === 0 ? 'inflow' : 'outflow',
      amount: 1000 + (i % 50) * 10,
      currency: 'USD',
      asset: null,
      dueDate: date,
      sourceAccountId: null,
      sourceVenueKind: null,
      confidence: 'confirmed',
      source: 'manual',
      status: 'upcoming',
      recurrence: 'once',
      recurrenceCron: null,
      counterpartyId: null,
      erpReference: null,
      recurringParentId: null,
      tags: [],
      metadata: {},
      paidAt: null,
      settlementTxRef: null,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    });
  }
  return arr;
}

describe('ForecastEngine performance (warn-only)', () => {
  it('projects 500 obligations over 90 days under the target', () => {
    const engine = new ForecastEngine();
    const state: TreasuryStateSnapshot = {
      id: 's',
      enterpriseId: 'e',
      takenAt: '2026-04-10T00:00:00Z',
      takenBy: null,
      trigger: 'on_demand',
      baseCurrency: 'USD',
      totalValueBaseUsd: 10_000_000,
      totalFiatBaseUsd: 10_000_000,
      totalStablecoinBaseUsd: 0,
      totalDefiBaseUsd: 0,
      totalBankBaseUsd: 10_000_000,
      totalStablecoinIdleBaseUsd: 0,
      totalMmfBaseUsd: 0,
      totalDefiVaultBaseUsd: 0,
      totalDefiLendingBaseUsd: 0,
      totalOtherBaseUsd: 0,
      positions: {
        bankAccounts: [
          {
            accountId: 'ba_1',
            institutionName: 'Bench Bank',
            accountName: 'Primary Operating',
            last4: '0001',
            currency: 'USD',
            balanceNative: 10_000_000,
            balanceBaseUsd: 10_000_000,
            balanceAsOf: null,
          },
        ],
        wallets: [],
        defiPositions: [],
        pendingTransfers: [],
      },
      fxRates: {},
    };
    const obligations = buildObligations(500);

    const t0 = performance.now();
    const proj = engine.project({
      state,
      obligations,
      from: new Date('2026-04-10T00:00:00Z'),
      windowDays: 90,
      fxRates: { 'USD->USD': 1 },
      scenarioParams: {
        includeExpected: true,
        includeEstimated: false,
        extraDrawdownPct: 0,
        fxStrategy: 'current',
      },
    });
    const elapsed = performance.now() - t0;

    expect(proj.daily).toHaveLength(91);

    if (elapsed > TARGET_MS) {
      // Warn-only per the Phase A plan. Do not fail on the target.
      // The hard ceiling assertion below guards against genuine
      // regressions (e.g. accidental O(n^2) shortfall-loop bugs).
      // eslint-disable-next-line no-console
      console.warn(
        `[bench] ForecastEngine projection took ${elapsed.toFixed(1)}ms (soft target ${TARGET_MS}ms)`,
      );
    }
    expect(elapsed).toBeLessThan(HARD_CEILING_MS);
  });
});
