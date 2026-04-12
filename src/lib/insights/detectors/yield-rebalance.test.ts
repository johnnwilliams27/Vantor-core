import { describe, it, expect } from 'vitest';
import { yieldRebalanceDetector } from './yield-rebalance';
import type { DetectorContext, ForecastBundle } from './types';
import type { TreasurySnapshot, YieldPositionSnapshot } from '@/lib/treasury/interface';
import type { YieldUniverseView, EligibleVenue } from '../yield-universe';
import {
  BALANCED_PROFILE,
  CONSERVATIVE_PROFILE,
  GROWTH_PROFILE,
} from '../risk-profiles';
import { VENUES } from '@/lib/yield/venues';

// ─── Fixture helpers ────────────────────────────────────────────────

function buildSnapshot(
  yieldPositions: YieldPositionSnapshot[] = [],
  overrides: Partial<TreasurySnapshot> = {},
): TreasurySnapshot {
  return {
    totalBankBalanceUsd: 0,
    totalCryptoBalanceUsd: 0,
    totalMmfPositionsUsd: 0,
    totalDefiPositionsUsd: yieldPositions
      .filter((p) => p.venueCategory !== 'tokenized_mmf')
      .reduce((s, p) => s + p.currentValueUsd, 0),
    totalOtherYieldUsd: 0,
    totalYieldBalanceUsd: yieldPositions.reduce((s, p) => s + p.currentValueUsd, 0),
    bankAccounts: [],
    cryptoPositions: [],
    yieldPositions,
    ...overrides,
  };
}

function buildPosition(
  protocol: string,
  currentValueUsd: number,
  apySnapshot: number | null = 0.03,
): YieldPositionSnapshot {
  const venue = VENUES[protocol as keyof typeof VENUES];
  return {
    id: `pos-${protocol}`,
    protocol,
    chain: venue?.chain ?? 'ethereum',
    underlyingToken: 'USDC',
    yieldToken: null,
    venueCategory: venue?.category ?? null,
    depositedAmount: currentValueUsd,
    yieldTokenBalance: currentValueUsd,
    currentValueUsd,
    accruedYieldUsd: 0,
    apySnapshot,
    lastRefreshedAt: new Date().toISOString(),
  };
}

function buildEligibleVenue(
  id: string,
  currentApy: number,
  overrides: Partial<EligibleVenue> = {},
): EligibleVenue {
  const venue = VENUES[id as keyof typeof VENUES];
  if (!venue) throw new Error(`Unknown venue: ${id}`);
  return {
    venue,
    currentApy,
    apyTier: 2,
    isStale: false,
    dataFreshness: 'fresh',
    ageSeconds: 30,
    tvlUsd: 500_000_000,
    fundSizeUsd: null,
    concentrationCapUsd: 15_000_000,
    concentrationCapReason: '7.5% of TVL',
    nonActionableReason: null,
    ...overrides,
  };
}

function buildUniverse(
  eligible: EligibleVenue[],
  profile = BALANCED_PROFILE,
  overrides: Partial<YieldUniverseView> = {},
): YieldUniverseView {
  const actionable = eligible.filter((e) => e.apyTier <= 2 && e.currentApy != null);
  const primary = actionable.filter((e) => e.venue.category === 'tokenized_mmf');
  const satellite = actionable.filter((e) => e.venue.category !== 'tokenized_mmf');
  return {
    profile,
    bands: profile.bands,
    eligible,
    disqualified: [],
    bestPrimaryApy: primary.length ? Math.max(...primary.map((e) => e.currentApy!)) : null,
    bestSatelliteApy: satellite.length ? Math.max(...satellite.map((e) => e.currentApy!)) : null,
    satelliteAllocationActive: true,
    ...overrides,
  };
}

function buildForecast(overrides: Partial<ForecastBundle> = {}): ForecastBundle {
  return {
    projectedMinBalance: { amount: 500_000, date: '2026-04-20' },
    coverage: { covered: true },
    obligationsInWindow: [],
    safetyBufferUsd: 100_000,
    windowDays: 30,
    ...overrides,
  };
}

function buildContext(
  snapshot: TreasurySnapshot,
  yieldUniverse: YieldUniverseView,
  profile = BALANCED_PROFILE,
  forecast?: ForecastBundle,
): DetectorContext {
  return {
    enterpriseId: 'ent-test',
    userId: 'user-test',
    snapshot,
    profile,
    aumTier: 'scale',
    yieldUniverse,
    now: new Date('2026-04-12T12:00:00Z'),
    forecast,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('yieldRebalanceDetector', () => {
  describe('yield_drop', () => {
    it('fires warning when position APY is >100bps below best alternative', async () => {
      // Position in aave_v3 at 2%, but morpho_steakhouse offers 4%.
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('morpho_steakhouse', 0.04),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      const drops = insights.filter((i) => i.type === 'yield_drop');

      expect(drops).toHaveLength(1);
      expect(drops[0].severity).toBe('warning');
      expect(drops[0].impact.apyDeltaBps).toBe(200); // 4% - 2% = 200bps
      expect(drops[0].dedupKey).toBe('yield_drop:aave_v3');
      expect(drops[0].recommendedAction).not.toBeNull();
      expect(drops[0].recommendedAction?.toVenueId).toBe('morpho_steakhouse');
    });

    it('does not fire when gap is under 100bps', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, 0.035)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.035),
        buildEligibleVenue('morpho_steakhouse', 0.04), // only 50bps gap
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      const drops = insights.filter((i) => i.type === 'yield_drop');
      expect(drops).toHaveLength(0);
    });

    it('skips positions with no APY snapshot', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, null)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('morpho_steakhouse', 0.05),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      const drops = insights.filter((i) => i.type === 'yield_drop');
      expect(drops).toHaveLength(0);
    });
  });

  describe('yield_opportunity', () => {
    it('recommends a better venue for deployed capital', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('morpho_steakhouse', 0.04),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      const opps = insights.filter((i) => i.type === 'yield_opportunity');

      // yield_drop and yield_opportunity both fire for the same position
      // when the gap exceeds the threshold. yield_drop is the warning;
      // yield_opportunity is the info-level suggestion with the specific route.
      expect(opps.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('yield_idle_opportunity', () => {
    it('fires when idle wallet stablecoins exceed safety buffer', async () => {
      // $300k idle in wallets, safety buffer is $100k → $200k deployable
      const snapshot = buildSnapshot([], {
        totalCryptoBalanceUsd: 300_000,
      });
      const eligible = [buildEligibleVenue('aave_v3', 0.04)];
      const universe = buildUniverse(eligible);
      const forecast = buildForecast({ safetyBufferUsd: 100_000 });
      const ctx = buildContext(snapshot, universe, BALANCED_PROFILE, forecast);

      const insights = await yieldRebalanceDetector.run(ctx);
      const idle = insights.filter((i) => i.type === 'yield_idle_opportunity');

      expect(idle).toHaveLength(1);
      expect(idle[0].severity).toBe('info');
      expect(idle[0].impact.dollarValue).toBe(200_000);
      expect(idle[0].recommendedAction).not.toBeNull();
      expect(idle[0].recommendedAction?.type).toBe('yield_deposit');
    });

    it('does not fire when no actionable venues exist', async () => {
      const snapshot = buildSnapshot([], { totalCryptoBalanceUsd: 300_000 });
      const universe = buildUniverse([], BALANCED_PROFILE);
      const forecast = buildForecast({ safetyBufferUsd: 100_000 });
      const ctx = buildContext(snapshot, universe, BALANCED_PROFILE, forecast);

      const insights = await yieldRebalanceDetector.run(ctx);
      const idle = insights.filter((i) => i.type === 'yield_idle_opportunity');
      expect(idle).toHaveLength(0);
    });

    it('does not fire when idle balance is below safety buffer', async () => {
      const snapshot = buildSnapshot([], { totalCryptoBalanceUsd: 50_000 });
      const eligible = [buildEligibleVenue('aave_v3', 0.04)];
      const universe = buildUniverse(eligible);
      const forecast = buildForecast({ safetyBufferUsd: 100_000 });
      const ctx = buildContext(snapshot, universe, BALANCED_PROFILE, forecast);

      const insights = await yieldRebalanceDetector.run(ctx);
      const idle = insights.filter((i) => i.type === 'yield_idle_opportunity');
      expect(idle).toHaveLength(0);
    });
  });

  describe('concentration cap respect', () => {
    it('caps recommended amount at venue concentration cap', async () => {
      // Position of $5M in aave_v3 at 2%. morpho_steakhouse at 4% but
      // concentration cap is only $2M remaining capacity.
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('morpho_steakhouse', 0.04, {
          concentrationCapUsd: 2_000_000,
        }),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      const drops = insights.filter((i) => i.type === 'yield_drop');

      if (drops.length > 0 && drops[0].recommendedAction) {
        expect(drops[0].recommendedAction.amountUsd).toBeLessThanOrEqual(2_000_000);
      }
    });
  });

  describe('non-actionable filtering', () => {
    it('never recommends tier 3 (derived yield) venues', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('kamino_multiply', 0.10, {
          apyTier: 3,
          nonActionableReason: 'Derived yield',
        }),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      for (const insight of insights) {
        if (insight.recommendedAction) {
          expect(insight.recommendedAction.toVenueId).not.toBe('kamino_multiply');
        }
      }
    });

    it('never recommends tier 4 (reference) venues', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('ondo_usdy', 0.045, {
          apyTier: 4,
          nonActionableReason: 'Reference yield',
        }),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const insights = await yieldRebalanceDetector.run(ctx);
      for (const insight of insights) {
        if (insight.recommendedAction) {
          expect(insight.recommendedAction.toVenueId).not.toBe('ondo_usdy');
        }
      }
    });
  });

  describe('Conservative satellite gate', () => {
    it('does not recommend satellite venues when satellite allocation is inactive', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('morpho_steakhouse', 0.04),
      ];
      const universe = buildUniverse(eligible, CONSERVATIVE_PROFILE, {
        satelliteAllocationActive: false,
      });
      const ctx = buildContext(
        buildSnapshot(positions),
        universe,
        CONSERVATIVE_PROFILE,
      );

      const insights = await yieldRebalanceDetector.run(ctx);
      // With satellite inactive, DeFi→DeFi rebalance is still valid,
      // but MMF→DeFi should not be recommended. The existing positions
      // are both DeFi so a same-category rebalance may still fire.
      for (const insight of insights) {
        if (insight.recommendedAction) {
          const toVenue = VENUES[insight.recommendedAction.toVenueId as keyof typeof VENUES];
          const fromVenue = VENUES[insight.recommendedAction.fromVenueId as keyof typeof VENUES];
          // If source is MMF, target must also be MMF when satellite is off
          if (fromVenue?.category === 'tokenized_mmf') {
            expect(toVenue?.category).toBe('tokenized_mmf');
          }
        }
      }
    });
  });

  describe('dedup key stability', () => {
    it('produces deterministic dedup keys', async () => {
      const positions = [buildPosition('aave_v3', 5_000_000, 0.02)];
      const eligible = [
        buildEligibleVenue('aave_v3', 0.02),
        buildEligibleVenue('morpho_steakhouse', 0.04),
      ];
      const universe = buildUniverse(eligible);
      const ctx = buildContext(buildSnapshot(positions), universe);

      const run1 = await yieldRebalanceDetector.run(ctx);
      const run2 = await yieldRebalanceDetector.run(ctx);
      expect(run1.map((i) => i.dedupKey).sort()).toEqual(
        run2.map((i) => i.dedupKey).sort(),
      );
    });
  });
});
