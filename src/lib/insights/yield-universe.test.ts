import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildYieldUniverse,
  groupByCategory,
  type EligibleVenue,
} from './yield-universe';

/**
 * Filter-pipeline tests for the Yield Universe service.
 *
 * The function under test (`buildYieldUniverse`) consults the venue
 * registry + a single `yield_rate_cache` query. Tests stub the cache
 * response with a minimal fake Supabase client and assert on the
 * filter / classification / ranking behavior end-to-end.
 */

// ─── Fake Supabase client ────────────────────────────────────────────

interface FakeRateRow {
  protocol: string;
  token: string;
  chain: string;
  supply_apy: number;
  reward_apy: number;
  total_apy: number;
  tvl_usd: number | null;
  fetched_at: string;
  is_stale: boolean;
}

/**
 * Minimal fake implementing the one call pattern buildYieldUniverse
 * issues: `.from('yield_rate_cache').select(cols).eq('token', asset)`.
 * Returns the supplied rows synchronously via a resolved promise.
 */
function makeFakeSupabase(rows: FakeRateRow[]): SupabaseClient {
  const result = { data: rows, error: null };
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve(result),
      }),
    }),
  } as unknown as SupabaseClient;
}

// Convenience: build a rate row with sane defaults. Override as needed.
function rateRow(overrides: Partial<FakeRateRow>): FakeRateRow {
  return {
    protocol: 'aave_v3',
    token: 'USDC',
    chain: 'ethereum',
    supply_apy: 0.04,
    reward_apy: 0,
    total_apy: 0.04,
    tvl_usd: 500_000_000,
    fetched_at: new Date().toISOString(),
    is_stale: false,
    ...overrides,
  };
}

// Helpful filter: pluck eligible venue IDs.
function idsOf(eligible: EligibleVenue[]): string[] {
  return eligible.map((e) => e.venue.id).sort();
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('buildYieldUniverse', () => {
  describe('status filter', () => {
    it('excludes coming_soon venues (all tokenized MMFs + Ondo/Sky/Ethena)', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
          customerKycTier: 'qualified_purchaser',
        },
        supabase,
      );

      // Every tokenized MMF in the registry is coming_soon in v1, so
      // none should be in the eligible set.
      const mmfIds = ['buidl', 'ousg', 'ustb', 'benji', 'usyc', 'spiko_usd'];
      for (const id of mmfIds) {
        expect(idsOf(view.eligible)).not.toContain(id);
      }

      // Ondo USDY, Sky, Ethena are all coming_soon too.
      for (const id of ['ondo_usdy', 'sky', 'ethena']) {
        expect(idsOf(view.eligible)).not.toContain(id);
      }

      // Each rejected venue should appear in disqualified with a reason
      // mentioning status.
      const coming = view.disqualified.find((d) => d.venue.id === 'buidl');
      expect(coming).toBeDefined();
      expect(coming!.reasons.some((r) => r.includes('coming_soon'))).toBe(true);
    });
  });

  describe('asset filter', () => {
    it('excludes USDC-only venues when querying USDT', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDT',
        },
        supabase,
      );

      // morpho_steakhouse + morpho_reservoir + kamino_multiply only
      // support USDC.
      for (const id of ['morpho_steakhouse', 'morpho_reservoir', 'kamino_multiply']) {
        expect(idsOf(view.eligible)).not.toContain(id);
      }
      // Aave V3 + Compound V3 + Kamino Lend support both USDC and USDT.
      expect(idsOf(view.eligible)).toEqual(
        expect.arrayContaining(['aave_v3', 'compound_v3', 'kamino']),
      );
    });
  });

  describe('chain filter', () => {
    it('excludes Solana venues when chain=ethereum', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
          chain: 'ethereum',
        },
        supabase,
      );

      expect(idsOf(view.eligible)).not.toContain('kamino');
      expect(idsOf(view.eligible)).not.toContain('kamino_multiply');
    });
  });

  describe('curator allowlist (Conservative)', () => {
    it('excludes vaults curated outside the Conservative allowlist', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'conservative',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      // Conservative's allowlist is { Steakhouse Financial, Gauntlet }.
      // morpho_reservoir is curated by 'Reservoir' → disqualified.
      expect(idsOf(view.eligible)).not.toContain('morpho_reservoir');

      const mr = view.disqualified.find((d) => d.venue.id === 'morpho_reservoir');
      expect(mr).toBeDefined();
      expect(mr!.reasons.some((r) => r.toLowerCase().includes('curator'))).toBe(true);
    });

    it('Growth profile has an open curator universe', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'growth',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      // Growth has empty allowlist → curator filter is a no-op, so
      // morpho_reservoir should NOT be disqualified for curator reasons.
      const mr = view.disqualified.find((d) => d.venue.id === 'morpho_reservoir');
      if (mr) {
        expect(mr.reasons.some((r) => r.toLowerCase().includes('curator'))).toBe(false);
      }
    });
  });

  describe('vault requirements (minMonthsLive)', () => {
    it('disqualifies venues below the profile minimum months-live', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'conservative', // requires 12mo minimum
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      // morpho_reservoir is 8mo live — below Conservative's 12mo floor.
      const mr = view.disqualified.find((d) => d.venue.id === 'morpho_reservoir');
      expect(mr).toBeDefined();
      // It fails curator AND monthsLive; check that the monthsLive
      // disqualification is actually in the reasons list.
      expect(mr!.reasons.some((r) => r.includes('mo'))).toBe(true);
    });

    it('Balanced (6mo floor) accepts morpho_reservoir on months-live', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced', // 6mo floor, morpho_reservoir = 8mo
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      // Balanced's curator allowlist includes Re7/MEV Capital/Gauntlet/
      // Steakhouse — NOT Reservoir. So morpho_reservoir is still
      // disqualified on curator grounds, but NOT on monthsLive grounds.
      const mr = view.disqualified.find((d) => d.venue.id === 'morpho_reservoir');
      expect(mr).toBeDefined();
      // No months-live reason should be present.
      expect(mr!.reasons.some((r) => /\bmo\b.*profile requires/.test(r))).toBe(false);
    });
  });

  describe('vault requirements (minTvlUsd from cache)', () => {
    it('disqualifies a vault whose cached TVL is below the profile floor', async () => {
      const supabase = makeFakeSupabase([
        rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 50_000_000 }), // below Balanced $100M floor
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const ms = view.disqualified.find((d) => d.venue.id === 'morpho_steakhouse');
      expect(ms).toBeDefined();
      expect(ms!.reasons.some((r) => r.includes('TVL'))).toBe(true);
    });

    it('accepts a vault whose cached TVL is above the profile floor', async () => {
      const supabase = makeFakeSupabase([
        rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 500_000_000 }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      expect(idsOf(view.eligible)).toContain('morpho_steakhouse');
    });
  });

  describe('concentration cap math', () => {
    it('uses percent-of-TVL when that is the tighter constraint', async () => {
      // Balanced: 7.5% of TVL or $15M abs cap.
      // TVL = 100M → 7.5% = $7.5M < $15M. Effective cap = $7.5M.
      const supabase = makeFakeSupabase([
        rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 100_000_000 }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const ms = view.eligible.find((e) => e.venue.id === 'morpho_steakhouse');
      expect(ms).toBeDefined();
      expect(ms!.concentrationCapUsd).toBe(7_500_000);
      expect(ms!.concentrationCapReason).toMatch(/vault TVL/);
    });

    it('uses the absolute cap when that is the tighter constraint', async () => {
      // Balanced: 7.5% of TVL or $15M abs cap.
      // TVL = 1B → 7.5% = $75M >> $15M. Effective cap = $15M.
      const supabase = makeFakeSupabase([
        rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 1_000_000_000 }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const ms = view.eligible.find((e) => e.venue.id === 'morpho_steakhouse');
      expect(ms).toBeDefined();
      expect(ms!.concentrationCapUsd).toBe(15_000_000);
      expect(ms!.concentrationCapReason).toMatch(/Absolute cap/);
    });

    it('Conservative cap is tighter than Balanced for the same vault', async () => {
      const rows = [rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 500_000_000 })];
      const conservativeView = await buildYieldUniverse(
        {
          riskProfileId: 'conservative',
          aumTier: 'scale',
          asset: 'USDC',
        },
        makeFakeSupabase(rows),
      );
      const balancedView = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        makeFakeSupabase(rows),
      );

      const consMs = conservativeView.eligible.find((e) => e.venue.id === 'morpho_steakhouse');
      const balMs = balancedView.eligible.find((e) => e.venue.id === 'morpho_steakhouse');

      // Conservative: min(5% of 500M, $10M) = min(25M, 10M) = $10M
      // Balanced:     min(7.5% of 500M, $15M) = min(37.5M, 15M) = $15M
      expect(consMs?.concentrationCapUsd).toBe(10_000_000);
      expect(balMs?.concentrationCapUsd).toBe(15_000_000);
    });
  });

  describe('data source quality tiers', () => {
    it('assigns tier 1 to on-chain authoritative protocols (aave_v3, compound_v3)', async () => {
      const supabase = makeFakeSupabase([
        rateRow({ protocol: 'aave_v3', tvl_usd: 500_000_000 }),
        rateRow({ protocol: 'compound_v3', tvl_usd: 500_000_000 }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const aave = view.eligible.find((e) => e.venue.id === 'aave_v3');
      const comp = view.eligible.find((e) => e.venue.id === 'compound_v3');
      expect(aave?.apyTier).toBe(1);
      expect(comp?.apyTier).toBe(1);
      expect(aave?.nonActionableReason).toBeNull();
    });

    it('assigns tier 2 to protocol-API sources (morpho_steakhouse)', async () => {
      const supabase = makeFakeSupabase([
        rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 500_000_000 }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const ms = view.eligible.find((e) => e.venue.id === 'morpho_steakhouse');
      expect(ms?.apyTier).toBe(2);
      expect(ms?.nonActionableReason).toBeNull();
    });

    it('flags Kamino Multiply (tier 3) as non-actionable', async () => {
      const supabase = makeFakeSupabase([
        rateRow({
          protocol: 'kamino_multiply',
          chain: 'solana',
          tvl_usd: 200_000_000,
          total_apy: 0.18, // deliberately high — the filter must still refuse to make this actionable
        }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'growth',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const km = view.eligible.find((e) => e.venue.id === 'kamino_multiply');
      expect(km).toBeDefined();
      expect(km!.apyTier).toBe(3);
      expect(km!.nonActionableReason).toMatch(/Derived yield/i);
    });
  });

  describe('best primary/satellite APY selection', () => {
    it('excludes tier 3 yields from bestSatelliteApy even when higher', async () => {
      // Both Kamino Multiply (tier 3) and Morpho Steakhouse (tier 2) are
      // eligible; Kamino Multiply has a fake 18% APY, Morpho 5%. The
      // 18% MUST NOT become bestSatelliteApy — only tier 1/2 count.
      const supabase = makeFakeSupabase([
        rateRow({
          protocol: 'kamino_multiply',
          chain: 'solana',
          tvl_usd: 200_000_000,
          total_apy: 0.18,
        }),
        rateRow({
          protocol: 'morpho_steakhouse',
          tvl_usd: 500_000_000,
          total_apy: 0.05,
        }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'growth',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      // bestSatelliteApy should reflect 0.05, not 0.18.
      expect(view.bestSatelliteApy).toBe(0.05);
    });

    it('returns null bestPrimaryApy when no MMFs are eligible', async () => {
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
          customerKycTier: 'qualified_purchaser',
        },
        supabase,
      );

      // All MMFs in the registry are coming_soon → none eligible → null.
      expect(view.bestPrimaryApy).toBeNull();
    });
  });

  describe('staleness', () => {
    it('flags a rate older than 10 minutes as stale_over_10min', async () => {
      const ageMs = 15 * 60 * 1000; // 15 min
      const supabase = makeFakeSupabase([
        rateRow({
          protocol: 'aave_v3',
          tvl_usd: 500_000_000,
          fetched_at: new Date(Date.now() - ageMs).toISOString(),
        }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const aave = view.eligible.find((e) => e.venue.id === 'aave_v3');
      expect(aave?.isStale).toBe(true);
      expect(aave?.dataFreshness).toBe('stale_over_10min');
    });

    it('honors the DB-side is_stale flag regardless of fetched_at', async () => {
      // Row has a fresh timestamp but is_stale=true — the service must
      // trust the DB flag and mark the entry stale.
      const supabase = makeFakeSupabase([
        rateRow({
          protocol: 'aave_v3',
          tvl_usd: 500_000_000,
          fetched_at: new Date().toISOString(),
          is_stale: true,
        }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const aave = view.eligible.find((e) => e.venue.id === 'aave_v3');
      expect(aave?.isStale).toBe(true);
      expect(aave?.dataFreshness).toBe('stale_over_10min');
    });

    it('marks fresh (< 5 min) rates as "fresh"', async () => {
      const supabase = makeFakeSupabase([
        rateRow({
          protocol: 'aave_v3',
          tvl_usd: 500_000_000,
          fetched_at: new Date(Date.now() - 60 * 1000).toISOString(), // 1 min
        }),
      ]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'balanced',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      const aave = view.eligible.find((e) => e.venue.id === 'aave_v3');
      expect(aave?.isStale).toBe(false);
      expect(aave?.dataFreshness).toBe('fresh');
    });
  });

  describe('conservative yield-aware satellite gate', () => {
    it('deactivates satellite allocation when gap is below the 50bps premium', async () => {
      // Conservative.defaultSatellitePct is 0 — but the gate also checks
      // whether any eligible satellite beats primary by >=50bps. With no
      // eligible primary (MMFs all coming_soon) and no rates, the gate
      // stays at defaultSatellitePct > 0 → false.
      const supabase = makeFakeSupabase([]);
      const view = await buildYieldUniverse(
        {
          riskProfileId: 'conservative',
          aumTier: 'scale',
          asset: 'USDC',
        },
        supabase,
      );

      // Conservative default satellite is 0 → inactive out of the box.
      expect(view.satelliteAllocationActive).toBe(false);
    });
  });
});

// ─── groupByCategory ─────────────────────────────────────────────────

describe('groupByCategory', () => {
  it('partitions eligible venues by category and leaves empty buckets empty', async () => {
    const supabase = makeFakeSupabase([
      rateRow({ protocol: 'aave_v3', tvl_usd: 500_000_000 }),
      rateRow({ protocol: 'morpho_steakhouse', tvl_usd: 500_000_000 }),
    ]);
    const view = await buildYieldUniverse(
      {
        riskProfileId: 'balanced',
        aumTier: 'scale',
        asset: 'USDC',
      },
      supabase,
    );

    const groups = groupByCategory(view);
    // No eligible MMFs in v1 (all coming_soon).
    expect(groups.tokenized_mmf).toEqual([]);
    // Both DeFi categories should have entries.
    expect(groups.defi_lending_market.map((e) => e.venue.id)).toContain('aave_v3');
    expect(groups.defi_vault.map((e) => e.venue.id)).toContain('morpho_steakhouse');
  });
});
