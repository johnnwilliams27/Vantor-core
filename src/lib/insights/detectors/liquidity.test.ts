import { describe, it, expect } from 'vitest';
import { liquidityDetector } from './liquidity';
import type { DetectorContext, ForecastBundle } from './types';
import type { TreasurySnapshot } from '@/lib/treasury/interface';
import type { YieldUniverseView } from '../yield-universe';
import type { Obligation } from '@/lib/obligations/types';
import { BALANCED_PROFILE, CONSERVATIVE_PROFILE } from '../risk-profiles';
import type { RiskProfile } from '../risk-profiles';

/**
 * Tests for the Liquidity & Safety Buffer Detector.
 *
 * The detector is a pure function of DetectorContext → DetectedInsight[],
 * so tests build synthetic contexts and assert on the resulting insights.
 * No DB, no network, no mocks — just data in, data out.
 */

// ─── Fixture helpers ──────────────────────────────────────────────────

function buildSnapshot(overrides: Partial<TreasurySnapshot> = {}): TreasurySnapshot {
  return {
    totalBankBalanceUsd: 0,
    totalCryptoBalanceUsd: 0,
    totalMmfPositionsUsd: 0,
    totalDefiPositionsUsd: 0,
    totalOtherYieldUsd: 0,
    totalYieldBalanceUsd: 0,
    bankAccounts: [],
    cryptoPositions: [],
    yieldPositions: [],
    ...overrides,
  };
}

function buildForecast(overrides: Partial<ForecastBundle> = {}): ForecastBundle {
  return {
    projectedMinBalance: { amount: 500_000, date: '2026-05-01' },
    coverage: { covered: true },
    obligationsInWindow: [],
    safetyBufferUsd: 200_000,
    windowDays: 30,
    ...overrides,
  };
}

function buildEmptyUniverse(): YieldUniverseView {
  return {
    profile: BALANCED_PROFILE,
    bands: BALANCED_PROFILE.bands,
    eligible: [],
    disqualified: [],
    bestPrimaryApy: null,
    bestSatelliteApy: null,
    satelliteAllocationActive: false,
  };
}

function buildObligation(amount: number, dueDate: string): Obligation {
  return {
    id: `obligation-${dueDate}-${amount}`,
    enterpriseId: 'ent-test',
    userId: 'user-test',
    label: `Obligation due ${dueDate}`,
    description: null,
    direction: 'outflow',
    amount,
    currency: 'USD',
    asset: 'USDC',
    dueDate,
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
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

function buildContext(
  snapshot: TreasurySnapshot,
  forecast?: ForecastBundle,
  profile: RiskProfile = BALANCED_PROFILE,
): DetectorContext {
  return {
    enterpriseId: 'ent-test',
    userId: 'user-test',
    snapshot,
    profile,
    aumTier: 'growth',
    yieldUniverse: buildEmptyUniverse(),
    now: new Date('2026-04-12T00:00:00.000Z'),
    forecast,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('liquidityDetector', () => {
  it('returns [] when forecast is undefined (graceful degradation)', async () => {
    const ctx = buildContext(buildSnapshot(), undefined);
    const insights = await liquidityDetector.run(ctx);
    expect(insights).toHaveLength(0);
  });

  it('fires critical liquidity_below_buffer when projected min is below safety buffer', async () => {
    // Safety buffer = $500k, projected min = $300k → shortfall of $200k
    const snapshot = buildSnapshot({ totalBankBalanceUsd: 1_000_000 });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 300_000, date: '2026-05-10' },
      safetyBufferUsd: 500_000,
      coverage: { covered: true },
      obligationsInWindow: [buildObligation(100_000, '2026-05-10')],
      windowDays: 30,
    });
    const ctx = buildContext(snapshot, forecast);

    const insights = await liquidityDetector.run(ctx);
    expect(insights).toHaveLength(1);
    const insight = insights[0];
    expect(insight.type).toBe('liquidity_below_buffer');
    expect(insight.severity).toBe('critical');
    expect(insight.dedupKey).toBe('liquidity_below_buffer:USD');
    expect((insight.rationale as { shortfallUsd: number }).shortfallUsd).toBe(200_000);
    expect((insight.impact as { dollarValue: number }).dollarValue).toBe(200_000);
  });

  it('does not fire when projected min is above safety buffer', async () => {
    // Safety buffer = $200k, projected min = $500k → no breach.
    // Bank balance kept at $300k so available cash ($300k) is < 2×$200k ($400k)
    // — ensuring idle_cash also doesn't fire.
    const snapshot = buildSnapshot({ totalBankBalanceUsd: 300_000 });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 500_000, date: '2026-05-01' },
      safetyBufferUsd: 200_000,
    });
    const ctx = buildContext(snapshot, forecast);

    const insights = await liquidityDetector.run(ctx);
    expect(insights).toHaveLength(0);
  });

  it('includes shortfall details in rationale when coverage fails', async () => {
    // Obligation coverage also fails — shortfall details should appear in rationale
    const snapshot = buildSnapshot({ totalBankBalanceUsd: 800_000 });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 100_000, date: '2026-05-15' },
      safetyBufferUsd: 300_000,
      coverage: {
        covered: false,
        shortfallAmount: 50_000,
        firstShortfallDate: '2026-05-15',
        shortfallAsset: 'USDC',
      },
      obligationsInWindow: [buildObligation(200_000, '2026-05-15')],
      windowDays: 30,
    });
    const ctx = buildContext(snapshot, forecast);

    const insights = await liquidityDetector.run(ctx);
    expect(insights).toHaveLength(1);
    const rationale = insights[0].rationale as {
      shortfall: { amount?: number; date?: string; asset?: string } | null;
    };
    expect(rationale.shortfall).not.toBeNull();
    expect(rationale.shortfall?.amount).toBe(50_000);
    expect(rationale.shortfall?.date).toBe('2026-05-15');
    expect(rationale.shortfall?.asset).toBe('USDC');
    // Summary should mention the shortfall
    expect(insights[0].summary).toContain('Obligation shortfall');
  });

  it('fires with conservative profile (higher multiplier = larger buffer)', async () => {
    // Conservative has safetyBufferMultiplier = 1.5 vs Balanced 1.25.
    // Same projected min of $400k. With Balanced buffer of $250k → no fire.
    // With Conservative buffer of $450k → fires.
    // Bank balance = $400k for Balanced: available cash ($400k) = exactly 2×$250k ($500k),
    // which does NOT exceed 2× (strictly greater), so idle_cash doesn't fire either.
    const balancedSnapshot = buildSnapshot({ totalBankBalanceUsd: 400_000 });
    const conservativeSnapshot = buildSnapshot({ totalBankBalanceUsd: 400_000 });
    const balancedForecast = buildForecast({
      projectedMinBalance: { amount: 400_000, date: '2026-05-01' },
      safetyBufferUsd: 250_000, // Balanced buffer
    });
    const conservativeForecast = buildForecast({
      projectedMinBalance: { amount: 400_000, date: '2026-05-01' },
      safetyBufferUsd: 450_000, // Conservative buffer (stricter)
    });

    const balancedCtx = buildContext(balancedSnapshot, balancedForecast, BALANCED_PROFILE);
    const conservativeCtx = buildContext(conservativeSnapshot, conservativeForecast, CONSERVATIVE_PROFILE);

    const balancedInsights = await liquidityDetector.run(balancedCtx);
    const conservativeInsights = await liquidityDetector.run(conservativeCtx);

    // Balanced: projected min ($400k) > buffer ($250k) → no fire
    expect(balancedInsights).toHaveLength(0);
    // Conservative: projected min ($400k) < buffer ($450k) → fires
    expect(conservativeInsights).toHaveLength(1);
    expect(conservativeInsights[0].type).toBe('liquidity_below_buffer');
  });

  it('fires info liquidity_idle_cash when available cash exceeds 2× safety buffer', async () => {
    // Safety buffer = $200k. Available cash = bank($500k) + wallet($100k) + mmf($50k) = $650k.
    // $650k > 2 × $200k ($400k) → idle cash fires.
    const snapshot = buildSnapshot({
      totalBankBalanceUsd: 500_000,
      totalCryptoBalanceUsd: 100_000,
      totalMmfPositionsUsd: 50_000,
    });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 550_000, date: '2026-05-01' },
      safetyBufferUsd: 200_000,
    });
    const ctx = buildContext(snapshot, forecast);

    const insights = await liquidityDetector.run(ctx);
    expect(insights).toHaveLength(1);
    const insight = insights[0];
    expect(insight.type).toBe('liquidity_idle_cash');
    expect(insight.severity).toBe('info');
    expect(insight.dedupKey).toBe('liquidity_idle_cash:USD');
    // Available cash = $650k, safetyBuffer = $200k, excess = $650k - $200k = $450k
    expect((insight.rationale as { excessUsd: number }).excessUsd).toBe(450_000);
  });

  it('does not fire idle cash when available cash is close to the buffer', async () => {
    // Safety buffer = $200k. Available cash = $350k.
    // $350k < 2 × $200k ($400k) → no idle fire.
    const snapshot = buildSnapshot({ totalBankBalanceUsd: 350_000 });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 400_000, date: '2026-05-01' },
      safetyBufferUsd: 200_000,
    });
    const ctx = buildContext(snapshot, forecast);

    const insights = await liquidityDetector.run(ctx);
    expect(insights).toHaveLength(0);
  });

  it('does not fire idle cash when below_buffer is already firing (mutual exclusion)', async () => {
    // Projected min < safety buffer → below_buffer fires.
    // Even if available cash nominally exceeds 2× buffer, idle_cash must NOT also fire.
    const snapshot = buildSnapshot({ totalBankBalanceUsd: 2_000_000 });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 50_000, date: '2026-05-01' },
      safetyBufferUsd: 500_000,
    });
    const ctx = buildContext(snapshot, forecast);

    const insights = await liquidityDetector.run(ctx);
    const types = insights.map((i) => i.type);
    // below_buffer fires; idle_cash must not
    expect(types).toContain('liquidity_below_buffer');
    expect(types).not.toContain('liquidity_idle_cash');
  });

  it('produces stable dedup keys across repeated runs for the same state', async () => {
    const snapshot = buildSnapshot({ totalBankBalanceUsd: 1_000_000 });
    const forecast = buildForecast({
      projectedMinBalance: { amount: 100_000, date: '2026-05-01' },
      safetyBufferUsd: 300_000,
    });
    const ctx = buildContext(snapshot, forecast);

    const run1 = await liquidityDetector.run(ctx);
    const run2 = await liquidityDetector.run(ctx);

    const keys1 = run1.map((i) => i.dedupKey).sort();
    const keys2 = run2.map((i) => i.dedupKey).sort();
    expect(keys1).toEqual(keys2);
    expect(keys1).toEqual(['liquidity_below_buffer:USD']);
  });
});
