import { describe, it, expect } from 'vitest';
import { concentrationDetector } from './concentration';
import type { DetectorContext } from './types';
import type { TreasurySnapshot, YieldPositionSnapshot } from '@/lib/treasury/interface';
import type { YieldUniverseView, EligibleVenue } from '../yield-universe';
import { CONSERVATIVE_PROFILE, BALANCED_PROFILE, GROWTH_PROFILE } from '../risk-profiles';
import { VENUES } from '@/lib/yield/venues';

/**
 * Tests for the Concentration Risk Detector.
 *
 * The detector is a pure function of DetectorContext → DetectedInsight[],
 * so tests build synthetic contexts and assert on the resulting insights.
 * No DB, no network, no mocks — just data in, data out.
 */

// ─── Test fixture helpers ────────────────────────────────────────────

/**
 * Build an empty TreasurySnapshot with the given yield positions.
 * Bank and crypto balances default to zero.
 */
function buildSnapshot(yieldPositions: YieldPositionSnapshot[] = []): TreasurySnapshot {
  return {
    totalBankBalanceUsd: 0,
    totalCryptoBalanceUsd: 0,
    totalMmfPositionsUsd: 0,
    totalDefiPositionsUsd: 0,
    totalOtherYieldUsd: 0,
    totalYieldBalanceUsd: yieldPositions.reduce((s, p) => s + p.currentValueUsd, 0),
    bankAccounts: [],
    cryptoPositions: [],
    yieldPositions,
  };
}

/**
 * Build a yield position. venueCategory is looked up from the registry
 * so tests stay in sync with the canonical categories.
 */
function buildYieldPosition(
  protocol: string,
  currentValueUsd: number,
  overrides: Partial<YieldPositionSnapshot> = {},
): YieldPositionSnapshot {
  const venue = VENUES[protocol as keyof typeof VENUES];
  return {
    id: `position-${protocol}`,
    protocol,
    chain: venue?.chain ?? 'ethereum',
    underlyingToken: 'USDC',
    yieldToken: null,
    venueCategory: venue?.category ?? null,
    depositedAmount: currentValueUsd,
    yieldTokenBalance: currentValueUsd,
    currentValueUsd,
    accruedYieldUsd: 0,
    apySnapshot: 0.04,
    lastRefreshedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a synthetic YieldUniverseView. Only populates what the
 * Concentration detector actually reads: eligible[] with venue + TVL +
 * concentration cap.
 */
function buildUniverse(
  profile = BALANCED_PROFILE,
  eligibleVenueIds: string[] = [],
): YieldUniverseView {
  const eligible: EligibleVenue[] = eligibleVenueIds.map((id) => {
    const venue = VENUES[id as keyof typeof VENUES];
    if (!venue) throw new Error(`Unknown venue in fixture: ${id}`);

    // Synthetic TVL: $500M by default, enough for Conservative/Balanced
    // 5%/7.5% caps to yield meaningful ($25M / $37.5M) per-vault limits.
    const tvlUsd = 500_000_000;
    const capUsd = Math.min(
      tvlUsd * profile.concentration.satellitePerVaultMaxVaultSharePct,
      profile.concentration.satellitePerVaultMaxAbsUsd,
    );

    return {
      venue,
      currentApy: 0.04,
      apyTier: 2,
      isStale: false,
      dataFreshness: 'fresh',
      ageSeconds: 30,
      tvlUsd,
      fundSizeUsd: null,
      concentrationCapUsd: capUsd,
      concentrationCapReason: `${profile.concentration.satellitePerVaultMaxVaultSharePct * 100}% of TVL`,
      nonActionableReason: null,
    };
  });

  return {
    profile,
    bands: profile.bands,
    eligible,
    disqualified: [],
    bestPrimaryApy: null,
    bestSatelliteApy: 0.04,
    satelliteAllocationActive: true,
  };
}

function buildContext(
  snapshot: TreasurySnapshot,
  yieldUniverse: YieldUniverseView = buildUniverse(),
  profile = BALANCED_PROFILE,
): DetectorContext {
  return {
    enterpriseId: 'ent-test',
    userId: 'user-test',
    snapshot,
    profile,
    aumTier: 'growth',
    yieldUniverse,
    now: new Date(),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('concentrationDetector', () => {
  describe('empty portfolio', () => {
    it('returns no insights when there are no yield positions', async () => {
      const ctx = buildContext(buildSnapshot([]));
      const insights = await concentrationDetector.run(ctx);
      expect(insights).toHaveLength(0);
    });
  });

  describe('per-vault concentration (DeFi lending market)', () => {
    it('fires concentration_breach when a position exceeds the per-vault cap', async () => {
      // Balanced cap = 7.5% of $500M TVL = $37.5M. Position of $50M breaches.
      const positions = [buildYieldPosition('aave_v3', 50_000_000)];
      const universe = buildUniverse(BALANCED_PROFILE, ['aave_v3']);
      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const vaultInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_vault',
      );

      expect(vaultInsights).toHaveLength(1);
      const breach = vaultInsights[0];
      expect(breach.type).toBe('concentration_breach');
      expect(breach.severity).toBe('critical');
      expect(breach.dedupKey).toBe('concentration_breach:per_vault:aave_v3');
      expect(breach.recommendedAction).not.toBeNull();
      expect(breach.recommendedAction?.type).toBe('yield_withdraw');
      expect(breach.recommendedAction?.fromVenueId).toBe('aave_v3');
    });

    it('fires concentration_warning at 80% of cap', async () => {
      // Balanced cap = min($500M × 7.5%, $15M abs) = $15M (abs cap binds).
      // 80% of $15M = $12M warning threshold. A $13M position warns but does not breach.
      const positions = [buildYieldPosition('aave_v3', 13_000_000)];
      const universe = buildUniverse(BALANCED_PROFILE, ['aave_v3']);
      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const vaultInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_vault',
      );

      expect(vaultInsights).toHaveLength(1);
      expect(vaultInsights[0].type).toBe('concentration_warning');
      expect(vaultInsights[0].severity).toBe('warning');
      expect(vaultInsights[0].recommendedAction).toBeNull();
    });

    it('does not fire below 80% of cap', async () => {
      // $10M << $30M warning threshold
      const positions = [buildYieldPosition('aave_v3', 10_000_000)];
      const universe = buildUniverse(BALANCED_PROFILE, ['aave_v3']);
      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const vaultInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_vault',
      );

      expect(vaultInsights).toHaveLength(0);
    });

    it('uses the profile-specific cap (Conservative is stricter)', async () => {
      // Conservative cap = 5% of $500M = $25M OR $10M, whichever is lower = $10M abs cap.
      // Position of $15M breaches Conservative but not Balanced.
      const positions = [buildYieldPosition('aave_v3', 15_000_000)];
      const conservativeUniverse = buildUniverse(CONSERVATIVE_PROFILE, ['aave_v3']);
      const ctx = buildContext(
        buildSnapshot(positions),
        conservativeUniverse,
        CONSERVATIVE_PROFILE,
      );

      const insights = await concentrationDetector.run(ctx);
      const vaultInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_vault',
      );

      expect(vaultInsights).toHaveLength(1);
      expect(vaultInsights[0].type).toBe('concentration_breach');
    });
  });

  describe('per-vault concentration (DeFi vault with curator)', () => {
    it('counts vault positions separately from lending market positions', async () => {
      const positions = [
        buildYieldPosition('morpho_steakhouse', 50_000_000),
        buildYieldPosition('aave_v3', 5_000_000),
      ];
      const universe = buildUniverse(BALANCED_PROFILE, ['morpho_steakhouse', 'aave_v3']);
      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const vaultInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_vault',
      );

      // Only morpho_steakhouse should breach; aave_v3 is under the threshold
      expect(vaultInsights).toHaveLength(1);
      expect((vaultInsights[0].rationale as { protocol: string }).protocol).toBe('morpho_steakhouse');
    });
  });

  describe('per-curator concentration (Growth profile only)', () => {
    it('fires when a single curator holds more than the per-curator cap', async () => {
      // Growth cap = 40% of satellite AUM. Two Morpho vaults both curated
      // by Steakhouse Financial + Reservoir → all satellite is one curator mix.
      // Single curator would be morpho_steakhouse alone holding > 40% of total.
      const positions = [
        buildYieldPosition('morpho_steakhouse', 50_000_000),
        buildYieldPosition('morpho_reservoir', 10_000_000),
      ];
      const universe = buildUniverse(GROWTH_PROFILE, ['morpho_steakhouse', 'morpho_reservoir']);
      const ctx = buildContext(buildSnapshot(positions), universe, GROWTH_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const curatorInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_curator',
      );

      // Steakhouse Financial holds 50M / 60M ≈ 83% of satellite → breach (cap 40%)
      const steakhouse = curatorInsights.find(
        (i) => (i.rationale as { curator: string }).curator === 'Steakhouse Financial',
      );
      expect(steakhouse).toBeDefined();
      expect(steakhouse?.type).toBe('concentration_breach');
    });

    it('does not fire per-curator insights for profiles without a curator cap', async () => {
      // Conservative has no per-curator cap, only per-vault.
      const positions = [buildYieldPosition('morpho_steakhouse', 5_000_000)];
      const universe = buildUniverse(CONSERVATIVE_PROFILE, ['morpho_steakhouse']);
      const ctx = buildContext(buildSnapshot(positions), universe, CONSERVATIVE_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const curatorInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_curator',
      );

      expect(curatorInsights).toHaveLength(0);
    });
  });

  describe('per-chain concentration', () => {
    it('does not fire per-chain for single-chain portfolios (structural)', async () => {
      // All positions on Ethereum — single-chain portfolios at >95% are
      // skipped as structural, not a warning.
      const positions = [
        buildYieldPosition('aave_v3', 5_000_000),
        buildYieldPosition('compound_v3', 5_000_000),
      ];
      const universe = buildUniverse(BALANCED_PROFILE, ['aave_v3', 'compound_v3']);
      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);

      const insights = await concentrationDetector.run(ctx);
      const chainInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_chain',
      );

      expect(chainInsights).toHaveLength(0);
    });
  });

  describe('data freshness flag', () => {
    it('propagates the venue freshness to the insight', async () => {
      const positions = [buildYieldPosition('aave_v3', 50_000_000)];
      const universe = buildUniverse(BALANCED_PROFILE, ['aave_v3']);
      // Mark the aave_v3 entry as stale
      universe.eligible[0].dataFreshness = 'stale_over_10min';
      universe.eligible[0].isStale = true;

      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);
      const insights = await concentrationDetector.run(ctx);
      const vaultInsights = insights.filter((i) =>
        (i.rationale as { axis?: string }).axis === 'per_vault',
      );

      expect(vaultInsights).toHaveLength(1);
      expect(vaultInsights[0].dataFreshness).toBe('stale_over_10min');
    });
  });

  describe('dedup key stability', () => {
    it('produces the same dedup_key on repeated runs for the same state', async () => {
      const positions = [buildYieldPosition('aave_v3', 50_000_000)];
      const universe = buildUniverse(BALANCED_PROFILE, ['aave_v3']);
      const ctx = buildContext(buildSnapshot(positions), universe, BALANCED_PROFILE);

      const run1 = await concentrationDetector.run(ctx);
      const run2 = await concentrationDetector.run(ctx);

      const keys1 = run1.map((i) => i.dedupKey).sort();
      const keys2 = run2.map((i) => i.dedupKey).sort();
      expect(keys1).toEqual(keys2);
    });
  });
});
